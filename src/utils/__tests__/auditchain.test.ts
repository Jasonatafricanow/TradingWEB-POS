import { describe, it, expect } from 'vitest';
import { chainEntry, verifyChain, AUDIT_GENESIS } from '../auditchain';
import type { ChainedEntry, ChainFields } from '../auditchain';

const F = (id: string, detail: string): ChainFields => ({ id, at: Number(id), action: 'refund', staff: 'A', detail, approvedBy: null });

// 由 旧->新 字段构建，返回 store 的"新->旧"倒序
function build(oldestFirst: ChainFields[]): ChainedEntry[] {
  let head: ChainedEntry | undefined;
  const out: ChainedEntry[] = [];
  for (const f of oldestFirst) { head = chainEntry(head, f); out.push(head); }
  return out.reverse();
}

describe('auditchain · build & verify', () => {
  it('genesis + linkage', () => {
    const a = chainEntry(undefined, F('1', 'a'));
    expect(a.prevHash).toBe(AUDIT_GENESIS);
    const b = chainEntry(a, F('2', 'b'));
    expect(b.prevHash).toBe(a.hash);
  });
  it('valid chain verifies', () => {
    expect(verifyChain(build([F('1', 'a'), F('2', 'b'), F('3', 'c')]))).toEqual({ ok: true, brokenAt: null });
  });
});

describe('auditchain · tamper detection', () => {
  it('editing an entry breaks its self-hash', () => {
    const c = build([F('1', 'a'), F('2', 'b'), F('3', 'c')]); // [3,2,1]
    const t = c.map((e, i) => (i === 1 ? { ...e, detail: 'HACKED' } : e));
    expect(verifyChain(t)).toEqual({ ok: false, brokenAt: 1 });
  });
  it('deleting a middle entry breaks linkage', () => {
    const c = build([F('1', 'a'), F('2', 'b'), F('3', 'c')]); // [3,2,1]
    expect(verifyChain([c[0], c[2]])).toEqual({ ok: false, brokenAt: 0 });
  });
  it('reordering breaks linkage', () => {
    const c = build([F('1', 'a'), F('2', 'b'), F('3', 'c')]);
    expect(verifyChain([c[1], c[0], c[2]]).ok).toBe(false);
  });
  it('trimming oldest (tail) keeps window valid', () => {
    const c = build([F('1', 'a'), F('2', 'b'), F('3', 'c'), F('4', 'd')]);
    expect(verifyChain(c.slice(0, 2))).toEqual({ ok: true, brokenAt: null });
  });
  it('forged head without correct prevHash fails', () => {
    const c = build([F('1', 'a'), F('2', 'b')]); // [2,1]
    const forged = chainEntry(undefined, F('9', 'evil')); // prevHash=GENESIS
    expect(verifyChain([forged, ...c])).toEqual({ ok: false, brokenAt: 0 });
  });
});
