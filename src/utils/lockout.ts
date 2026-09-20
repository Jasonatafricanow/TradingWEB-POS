// PIN 试错限速策略（纯函数，node 可单测）：按员工隔离的连错锁定。
// 从 auth store 抽离，避免"全局共享计数"导致一人连错锁全店、或解锁与店长审批互相串扰。

export interface LockInfo {
  /** 当前连续错误次数（达上限后清零并进入锁定） */
  attempts: number;
  /** 锁定截止时间戳（ms）；null = 未锁定 */
  lockUntil: number | null;
}

export interface LockPolicy {
  maxAttempts: number;
  lockoutMs: number;
}

export const DEFAULT_LOCK_POLICY: LockPolicy = { maxAttempts: 5, lockoutMs: 60_000 };

/** 是否处于锁定中 */
export function isLocked(lock: LockInfo | undefined, now: number): boolean {
  return !!lock && lock.lockUntil !== null && now < lock.lockUntil;
}

/** 剩余锁定秒数（未锁定为 0） */
export function lockRemainingSec(lock: LockInfo | undefined, now: number): number {
  return isLocked(lock, now) ? Math.ceil(((lock as LockInfo).lockUntil! - now) / 1000) : 0;
}

/**
 * 一次校验后的下个锁定状态：
 *  - verified=true：清除该员工记录（返回 next=null），可重新计次。
 *  - verified=false：累加错误次数；达 maxAttempts 时进入锁定（计数清零、置 lockUntil）。
 * 纯函数，不读时钟——now 由调用方传入，便于测试。
 */
export function nextLockState(
  lock: LockInfo | undefined,
  verified: boolean,
  now: number,
  policy: LockPolicy = DEFAULT_LOCK_POLICY
): { next: LockInfo | null; justLocked: boolean; attemptsLeft: number } {
  if (verified) return { next: null, justLocked: false, attemptsLeft: policy.maxAttempts };
  const attempts = (lock?.attempts ?? 0) + 1;
  if (attempts >= policy.maxAttempts) {
    return { next: { attempts: 0, lockUntil: now + policy.lockoutMs }, justLocked: true, attemptsLeft: 0 };
  }
  return { next: { attempts, lockUntil: null }, justLocked: false, attemptsLeft: policy.maxAttempts - attempts };
}

/**
 * 在"按员工隔离"的锁定表上应用一次校验结果，返回新表（不可变，不改动其他员工条目）。
 * verified=true 时删除该员工记录（成功即清零）。
 */
export function applyAttempt(
  lockouts: Record<string, LockInfo>,
  staffId: string,
  verified: boolean,
  now: number,
  policy: LockPolicy = DEFAULT_LOCK_POLICY
): { lockouts: Record<string, LockInfo>; justLocked: boolean; attemptsLeft: number } {
  const { next, justLocked, attemptsLeft } = nextLockState(lockouts[staffId], verified, now, policy);
  const out = { ...lockouts };
  if (next === null) delete out[staffId];
  else out[staffId] = next;
  return { lockouts: out, justLocked, attemptsLeft };
}
