import { describe, it, expect } from 'vitest';
import { sha256Hex, hashPin, verifyPinHash, PIN_ITERATIONS } from '../hash';

describe('pin · salted hash format & verify', () => {
  it('hashPin emits self-describing sha256$iter$salt$digest', () => {
    const h = hashPin('1234');
    const parts = h.split('$');
    expect(parts.length).toBe(4);
    expect(parts[0]).toBe('sha256');
    expect(parts[1]).toBe(String(PIN_ITERATIONS));
    expect(parts[2].length).toBe(16); // 8 bytes hex
    expect(parts[3].length).toBe(64); // sha256 hex
  });
  it('correct pin verifies, wrong pin rejected', () => {
    const h = hashPin('1234');
    expect(verifyPinHash('1234', h).ok).toBe(true);
    expect(verifyPinHash('1235', h).ok).toBe(false);
    expect(verifyPinHash('', h).ok).toBe(false);
  });
  it('same pin => different salts => different stored strings, both verify', () => {
    const a = hashPin('1234');
    const b = hashPin('1234');
    expect(a === b).toBe(false);          // distinct salts (no equality leak)
    expect(verifyPinHash('1234', a).ok).toBe(true);
    expect(verifyPinHash('1234', b).ok).toBe(true);
  });
  it('explicit salt+iter is deterministic', () => {
    expect(hashPin('1234', 'deadbeefdeadbeef', 10)).toBe(hashPin('1234', 'deadbeefdeadbeef', 10));
  });
  it('new-format hash at current cost does not need upgrade', () => {
    expect(verifyPinHash('1234', hashPin('1234')).needsUpgrade).toBe(false);
  });
});

describe('pin · legacy migration', () => {
  it('legacy bare-hex (unsalted) still verifies and flags needsUpgrade', () => {
    const legacy = sha256Hex('1234'); // old on-disk format
    const r = verifyPinHash('1234', legacy);
    expect(r.ok).toBe(true);
    expect(r.needsUpgrade).toBe(true);
  });
  it('legacy bare-hex rejects wrong pin', () => {
    expect(verifyPinHash('0000', sha256Hex('1234')).ok).toBe(false);
  });
  it('stale iteration count flags needsUpgrade (auto re-stretch)', () => {
    const older = hashPin('1234', 'abcd0123abcd0123', 500); // iter != current
    const r = verifyPinHash('1234', older);
    expect(r.ok).toBe(true);
    expect(r.needsUpgrade).toBe(true);
  });
  it('full migration round-trip: legacy -> upgraded -> verifies, no further upgrade', () => {
    const pin = '5678';
    const legacy = sha256Hex(pin);
    const first = verifyPinHash(pin, legacy);
    expect(first.ok && first.needsUpgrade).toBe(true);
    const upgraded = hashPin(pin);              // what auth.ts writes back
    const second = verifyPinHash(pin, upgraded);
    expect(second.ok).toBe(true);
    expect(second.needsUpgrade).toBe(false);
    expect(verifyPinHash('9999', upgraded).ok).toBe(false);
  });
});

describe('pin · robustness', () => {
  it('null / malformed stored never throws, returns ok:false', () => {
    expect(verifyPinHash('1234', null).ok).toBe(false);
    expect(verifyPinHash('1234', undefined).ok).toBe(false);
    expect(verifyPinHash('1234', 'garbage').ok).toBe(false);
    expect(verifyPinHash('1234', 'sha256$$$').ok).toBe(false);
    expect(verifyPinHash('1234', 'md5$1000$aa$bb').ok).toBe(false);
  });
});
