// 认证与员工 PIN
// 安全设计（对应验收审计 高危1/4）：
//  - token 存 expo-secure-store（iOS Keychain / Android Keystore），不进 AsyncStorage
//  - 员工 PIN 只保存加盐迭代 SHA-256 哈希（每人独立盐），明文不落盘、不驻留 state；遗留无盐哈希在下次校验通过时透明升级
//  - PIN 验证按员工隔离限速：单个员工连续 5 次错误锁定 60 秒（计数持久化，重启不重置）；不会因一人连错而锁全店

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { EntityId, Staff } from '@/api/types';
import { hashPin, verifyPinHash } from '@/utils/hash';
import { applyAttempt, isLocked, lockRemainingSec } from '@/utils/lockout';
import type { LockInfo } from '@/utils/lockout';

/** 仅供离线 Mock/遗留本地员工使用；TradingWEB 解锁禁止使用该默认值。 */
export const DEFAULT_PIN = '1234';

const TOKEN_KEY = 'twpos.token.v2';
const LEGACY_TOKEN_KEY = 'twpos.token';
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 60_000;

/** 剥离明文 PIN，只留加盐哈希（每名员工独立随机盐）；无本地 PIN 的员工（TradingWEB 服务端解锁）不落任何可猜解哈希 */
function sanitizeStaff(s: Staff): Staff {
  if (!s.pin || s.pin.length === 0) {
    return { ...s, pin: null, pinHash: null, usesDefaultPin: false };
  }
  const pinHash = hashPin(s.pin);
  return { ...s, pin: null, pinHash, usesDefaultPin: false };
}

export interface PinResult {
  ok: boolean;
  code?: 'PIN_LOCKED_WAIT' | 'STAFF_NOT_FOUND' | 'PIN_TOO_SHORT' | 'PIN_LOCKED' | 'PIN_INVALID';
  params?: Readonly<{ seconds?: number; attempts?: number }>;
  message?: string;
}

interface AuthState {
  /** 仅内存 + SecureStore，不进 AsyncStorage */
  token: string | null;
  /** SecureStore 读取完成标志（根布局等待它再放行） */
  tokenLoaded: boolean;
  account: Staff | null;
  staffList: Staff[];
  currentStaff: Staff | null;
  locked: boolean;
  /** 按员工 id 隔离的试错/锁定状态（避免全局共享导致一人连错锁全店、或解锁与审批互相串扰） */
  pinLockouts: Record<EntityId, LockInfo>;
  loadToken: () => Promise<void>;
  signIn: (token: string, account: Staff, staffList: Staff[]) => void;
  setStaffList: (list: Staff[]) => void;
  /** 校验某员工 PIN（含按员工试错限速），不改变登录态 */
  verifyPin: (staffId: EntityId, pin: string) => PinResult;
  /** 校验并切换当前操作员 */
  unlock: (staffId: EntityId, pin: string) => PinResult;
  /** 服务端 operator session 已验证后，仅切换本地展示身份。 */
  activateStaff: (staffId: EntityId) => PinResult;
  /** Apply the authenticated operator session's authoritative server permissions. */
  applyOperatorPermissions: (staffId: EntityId, permissions: Staff['permissions']) => void;
  lock: () => void;
  signOut: () => Promise<void>;
}

const legacyMockStaffIds: Record<number, string> = {
  1: 'mock-staff-manager',
  2: 'mock-staff-clerk',
};

const migrateStaffId = (value: unknown): string | null => {
  if (typeof value === 'number') return legacyMockStaffIds[value] ?? `mock-staff-${value}`;
  if (value === null || value === undefined) return null;
  return String(value) || null;
};

function migrateStaff(value: unknown): Staff | null {
  if (!value || typeof value !== 'object') return null;
  const staff = { ...(value as Record<string, unknown>) };
  const id = migrateStaffId(staff.id);
  return id === null ? null : { ...(staff as unknown as Staff), id };
}

export function migrateAuthState(persisted: unknown, version: number): AuthState {
  const state = { ...((persisted ?? {}) as Record<string, unknown>) };
  if (version < 1) {
    delete state.pinAttempts;
    delete state.pinLockUntil;
    state.pinLockouts = {};
  }
  if (version < 2) {
    state.account = migrateStaff(state.account);
    state.currentStaff = migrateStaff(state.currentStaff);
    state.staffList = Array.isArray(state.staffList)
      ? state.staffList.map(migrateStaff).filter((staff): staff is Staff => staff !== null)
      : [];
    const oldLockouts =
      state.pinLockouts && typeof state.pinLockouts === 'object'
        ? (state.pinLockouts as Record<string, LockInfo>)
        : {};
    state.pinLockouts = Object.fromEntries(
      Object.entries(oldLockouts)
        .map(([id, lock]) => [migrateStaffId(/^\d+$/.test(id) ? Number(id) : id), lock] as const)
        .filter((entry): entry is readonly [string, LockInfo] => entry[0] !== null),
    );
    if (!state.account || !state.currentStaff) state.locked = true;
  }
  return state as unknown as AuthState;
}

export const useAuth = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      tokenLoaded: false,
      account: null,
      staffList: [],
      currentStaff: null,
      locked: true,
      pinLockouts: {},

      loadToken: async () => {
        try {
          const t = await SecureStore.getItemAsync(TOKEN_KEY);
          set({ token: t, tokenLoaded: true });
        } catch {
          set({ token: null, tokenLoaded: true });
        }
      },

      signIn: (token, account, staffList) => {
        const list = (staffList.length > 0 ? staffList : [account]).map(sanitizeStaff);
        set({
          token,
          tokenLoaded: true,
          account: sanitizeStaff(account),
          staffList: list,
          locked: true,
          currentStaff: null,
        });
        SecureStore.setItemAsync(TOKEN_KEY, token).catch(() => {});
      },

      setStaffList: (list) => {
        if (list.length > 0) set({ staffList: list.map(sanitizeStaff) });
      },

      verifyPin: (staffId, pin) => {
        const now = Date.now();
        const s = get();
        const lock = s.pinLockouts[staffId];
        // 锁定仅针对该员工，不影响其他员工解锁或店长审批
        if (isLocked(lock, now)) {
          return {
            ok: false,
            code: 'PIN_LOCKED_WAIT',
            params: { seconds: lockRemainingSec(lock, now) },
            message: `错误次数过多，请 ${lockRemainingSec(lock, now)} 秒后再试`,
          };
        }
        const staff = s.staffList.find((x) => x.id === staffId);
        if (!staff) return { ok: false, code: 'STAFF_NOT_FOUND', message: '员工不存在' };
        if (pin.length < 4) return { ok: false, code: 'PIN_TOO_SHORT', message: 'PIN 至少 4 位' };
        const res = verifyPinHash(pin, staff.pinHash);
        const { lockouts: pinLockouts, justLocked, attemptsLeft } = applyAttempt(
          s.pinLockouts,
          staffId,
          res.ok,
          now,
          { maxAttempts: MAX_ATTEMPTS, lockoutMs: LOCKOUT_MS }
        );

        if (res.ok) {
          // 透明迁移：遗留无盐哈希（或迭代次数变更）在校验通过时就地升级为当前加盐格式
          if (res.needsUpgrade) {
            const upgraded = hashPin(pin);
            set({
              pinLockouts,
              staffList: s.staffList.map((x) => (x.id === staffId ? { ...x, pinHash: upgraded } : x)),
            });
          } else {
            set({ pinLockouts });
          }
          return { ok: true };
        }
        set({ pinLockouts });
        if (justLocked) {
          return {
            ok: false,
            code: 'PIN_LOCKED',
            params: { attempts: MAX_ATTEMPTS, seconds: LOCKOUT_MS / 1000 },
            message: `PIN 连续错误 ${MAX_ATTEMPTS} 次，锁定 ${LOCKOUT_MS / 1000} 秒`,
          };
        }
        return {
          ok: false,
          code: 'PIN_INVALID',
          params: { attempts: attemptsLeft },
          message: `PIN 错误（剩余 ${attemptsLeft} 次机会）`,
        };
      },

      unlock: (staffId, pin) => {
        const r = get().verifyPin(staffId, pin);
        if (!r.ok) return r;
        const staff = get().staffList.find((x) => x.id === staffId)!;
        set({ currentStaff: staff, locked: false });
        return { ok: true };
      },

      activateStaff: (staffId) => {
        const staff = get().staffList.find((item) => item.id === staffId);
        if (!staff) return { ok: false, code: 'STAFF_NOT_FOUND', message: '员工不存在' };
        set({ currentStaff: staff, locked: false });
        return { ok: true };
      },

      applyOperatorPermissions: (staffId, permissions) => set((state) => ({
        staffList: state.staffList.map((staff) =>
          staff.id === staffId ? { ...staff, permissions: [...(permissions ?? [])] } : staff),
        currentStaff: state.currentStaff?.id === staffId
          ? { ...state.currentStaff, permissions: [...(permissions ?? [])] }
          : state.currentStaff,
        account: state.account?.id === staffId
          ? { ...state.account, permissions: [...(permissions ?? [])] }
          : state.account,
      })),

      lock: () => set({ locked: true }),

      signOut: async () => {
        set({ token: null, account: null, staffList: [], currentStaff: null, locked: true });
        const results = await Promise.allSettled([
          SecureStore.deleteItemAsync(TOKEN_KEY),
          SecureStore.deleteItemAsync(LEGACY_TOKEN_KEY),
        ]);
        const failed = results.find((result) => result.status === 'rejected');
        if (failed?.status === 'rejected') throw failed.reason;
      },
    }),
    {
      name: 'twpos-auth',
      storage: createJSONStorage(() => AsyncStorage),
      version: 2,
      migrate: migrateAuthState,
      // token 绝不进 AsyncStorage；staffList 此时已只含哈希
      partialize: (s) =>
        ({
          account: s.account,
          staffList: s.staffList,
          currentStaff: s.currentStaff,
          locked: s.locked,
          pinLockouts: s.pinLockouts,
        }) as unknown as AuthState,
    }
  )
);
