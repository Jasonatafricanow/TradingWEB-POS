// 操作日志防篡改：哈希链（纯函数，node 可单测）。
// 每条 entry 存 prevHash 与自身 hash = sha256(规范化内容含 prevHash)。
// 任意编辑/删除/重排都会让自哈希或相邻链接失配，被 verifyChain 检出。
// 局限（务必如实告知）：本地存储可被整体清空/覆盖，哈希链只提供"篡改可发现"，
//   无法防止整体擦除；需要真正不可抵赖时应把日志追加上报后端（见 BACKEND_API.md）。

import { sha256Hex } from './hash';

export const AUDIT_GENESIS = 'GENESIS';

export interface ChainFields {
  id: string;
  at: number;
  action: string;
  staff: string;
  detail: string;
  approvedBy: string | null;
  sourceScope?: {
    serverUrl: string;
    storeId: string;
    operatorId: string;
    deviceId: string;
  } | null;
}

export interface ChainedEntry extends ChainFields {
  prevHash: string;
  hash: string;
}

/** 参与哈希的规范化串：固定顺序的数组经 JSON 序列化（自动转义，无字段边界歧义），含 prevHash、不含 hash */
export function entryHash(e: ChainFields & { prevHash: string }): string {
  const facts: unknown[] = [e.prevHash, e.id, e.at, e.action, e.staff, e.detail, e.approvedBy ?? ''];
  if (e.sourceScope) {
    facts.push([
      e.sourceScope.serverUrl,
      e.sourceScope.storeId,
      e.sourceScope.operatorId,
      e.sourceScope.deviceId,
    ]);
  }
  return sha256Hex(JSON.stringify(facts));
}

/** 追加一条：head = 当前链头（最新条目，无则视为创世），返回带 prevHash+hash 的完整条目 */
export function chainEntry(head: ChainedEntry | undefined, fields: ChainFields): ChainedEntry {
  const prevHash = head ? head.hash : AUDIT_GENESIS;
  const hash = entryHash({ ...fields, prevHash });
  return { ...fields, prevHash, hash };
}

/**
 * 校验链（entries 为"新→旧"倒序，与 store 存储一致）：
 *  - 每条自哈希需与内容一致；
 *  - 相邻两条需链接：较新条目的 prevHash == 较旧条目的 hash。
 * 窗口最旧一条的 prevHash 指向已被裁剪的更早条目，只校验其自哈希、不校验该链接。
 * 返回首个断裂下标（新→旧序）；ok=true 时 brokenAt=null。
 */
export function verifyChain(entries: ChainedEntry[]): { ok: boolean; brokenAt: number | null } {
  for (let i = 0; i < entries.length; i++) {
    const { hash, ...rest } = entries[i];
    if (entryHash(rest) !== hash) return { ok: false, brokenAt: i };
    const older = entries[i + 1];
    if (older && entries[i].prevHash !== older.hash) return { ok: false, brokenAt: i };
  }
  return { ok: true, brokenAt: null };
}
