import { describe, expect, it } from 'vitest';

import {
  localPinFailureMessage,
  managerApprovalErrorMessage,
  managerApprovalTitle,
} from '@/i18n/manager-approval';

describe('manager approval presentation', () => {
  it('interpolates the visible action label without changing its operation ID', () => {
    expect(managerApprovalTitle('en', 'Refund')).toBe('Manager approval · Refund');
  });

  it('maps every local PIN result by stable code', () => {
    expect(localPinFailureMessage('en', {
      ok: false,
      code: 'PIN_INVALID',
      params: { attempts: 3 },
      message: 'sensitive legacy text',
    })).toBe('Incorrect PIN. 3 attempts remaining.');
    expect(localPinFailureMessage('en', {
      ok: false,
      code: 'PIN_LOCKED_WAIT',
      params: { seconds: 12 },
    })).toBe('Too many attempts. Try again in 12 seconds.');
  });

  it('uses coded API failures and hides unknown error messages', () => {
    expect(managerApprovalErrorMessage('pt', { code: 'PIN_INVALID' })).toBe(
      'O PIN é inválido.',
    );
    expect(managerApprovalErrorMessage('en', new Error('secret server text'))).toBe(
      'Approval was denied or could not be completed.',
    );
  });
});
