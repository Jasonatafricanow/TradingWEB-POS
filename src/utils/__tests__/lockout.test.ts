import { describe, it, expect } from 'vitest';
import { isLocked, lockRemainingSec, nextLockState, applyAttempt, DEFAULT_LOCK_POLICY } from '../lockout';
import type { LockInfo } from '../lockout';

const P = { maxAttempts: 5, lockoutMs: 60000 };

describe('lockout · isLocked / remaining', () => {
  it('undefined or null lockUntil => not locked', () => {
    expect(isLocked(undefined, 1000)).toBe(false);
    expect(isLocked({ attempts: 3, lockUntil: null }, 1000)).toBe(false);
  });
  it('locked while now < lockUntil, expired at boundary', () => {
    const lock: LockInfo = { attempts: 0, lockUntil: 5000 };
    expect(isLocked(lock, 4999)).toBe(true);
    expect(isLocked(lock, 5000)).toBe(false);
    expect(lockRemainingSec(lock, 4000)).toBe(1);
    expect(lockRemainingSec(lock, 5000)).toBe(0);
  });
});

describe('lockout · nextLockState policy', () => {
  it('verified clears record', () => {
    const r = nextLockState({ attempts: 3, lockUntil: null }, true, 0, P);
    expect(r.next).toBe(null);
    expect(r.attemptsLeft).toBe(5);
  });
  it('first wrong => attempts 1, not locked', () => {
    const r = nextLockState(undefined, false, 0, P);
    expect(r.next).toEqual({ attempts: 1, lockUntil: null });
    expect(r.justLocked).toBe(false);
    expect(r.attemptsLeft).toBe(4);
  });
  it('reaching maxAttempts locks and zeroes counter', () => {
    const r = nextLockState({ attempts: 4, lockUntil: null }, false, 1000, P);
    expect(r.justLocked).toBe(true);
    expect(r.next).toEqual({ attempts: 0, lockUntil: 61000 });
    expect(r.attemptsLeft).toBe(0);
  });
});

describe('lockout · applyAttempt (per-staff isolation)', () => {
  it('failures on one staff do not touch another', () => {
    let m: Record<string, LockInfo> = {};
    m = applyAttempt(m, 'staff-1', false, 0, P).lockouts;
    m = applyAttempt(m, 'staff-1', false, 0, P).lockouts;
    expect(m['staff-1']).toEqual({ attempts: 2, lockUntil: null });
    expect(m['staff-2']).toBeUndefined();
    const r = applyAttempt(m, 'staff-2', false, 0, P);
    expect(r.lockouts['staff-2']).toEqual({ attempts: 1, lockUntil: null });
    expect(r.lockouts['staff-1']).toEqual({ attempts: 2, lockUntil: null });
  });
  it('5th failure locks only that staff; another stays unlocked', () => {
    let m: Record<string, LockInfo> = { 'staff-2': { attempts: 3, lockUntil: null } };
    for (let i = 0; i < 5; i++) m = applyAttempt(m, 'staff-1', false, 1000, P).lockouts;
    expect(isLocked(m['staff-1'], 1000)).toBe(true);
    expect(isLocked(m['staff-2'], 1000)).toBe(false);
  });
  it('success removes the staff key without mutating input', () => {
    const input: Record<string, LockInfo> = { 'staff-1': { attempts: 3, lockUntil: null } };
    const out = applyAttempt(input, 'staff-1', true, 0, P).lockouts;
    expect(out['staff-1']).toBeUndefined();
    expect(input['staff-1']).toEqual({ attempts: 3, lockUntil: null });
  });
});

describe('lockout · defaults', () => {
  it('DEFAULT_LOCK_POLICY is 5 / 60s', () => {
    expect(DEFAULT_LOCK_POLICY.maxAttempts).toBe(5);
    expect(DEFAULT_LOCK_POLICY.lockoutMs).toBe(60000);
  });
});
