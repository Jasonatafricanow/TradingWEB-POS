import { beforeEach, describe, expect, it } from 'vitest';
import type { Staff } from '@/api/types';
import { useAuth } from '@/stores/auth';

const staff: Staff = {
  id: 'staff-pin-result',
  name: 'PIN Result',
  role: 'staff',
  pin: '1234',
};

describe('local PIN result contract', () => {
  beforeEach(() => {
    useAuth.setState({ pinLockouts: {} });
    useAuth.getState().signIn('test-token', staff, [staff]);
  });

  it('returns stable codes and safe parameters for localized presentation', () => {
    expect(useAuth.getState().verifyPin(staff.id, '1')).toMatchObject({
      ok: false,
      code: 'PIN_TOO_SHORT',
    });
    expect(useAuth.getState().verifyPin(staff.id, '0000')).toMatchObject({
      ok: false,
      code: 'PIN_INVALID',
      params: { attempts: 4 },
    });

    useAuth.getState().verifyPin(staff.id, '0000');
    useAuth.getState().verifyPin(staff.id, '0000');
    useAuth.getState().verifyPin(staff.id, '0000');
    expect(useAuth.getState().verifyPin(staff.id, '0000')).toMatchObject({
      ok: false,
      code: 'PIN_LOCKED',
      params: { attempts: 5, seconds: 60 },
    });
  });
});
