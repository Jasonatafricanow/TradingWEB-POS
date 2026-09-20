import type { PinResult } from '@/stores/auth';
import { isTradingWebErrorCode, translateApiErrorCode } from './core/api-errors';
import { translate } from './core/catalog';
import type { Locale } from './core/locale';

export function managerApprovalTitle(locale: Locale, actionLabel: string): string {
  return translate(locale, 'manager.title', { action: actionLabel });
}

export function localPinFailureMessage(locale: Locale, result: PinResult): string {
  switch (result.code) {
    case 'PIN_LOCKED_WAIT':
      return translate(locale, 'auth.pin_locked_wait', {
        seconds: result.params?.seconds ?? 0,
      });
    case 'STAFF_NOT_FOUND':
      return translate(locale, 'auth.staff_not_found');
    case 'PIN_TOO_SHORT':
      return translate(locale, 'auth.pin_too_short');
    case 'PIN_LOCKED':
      return translate(locale, 'auth.pin_locked', {
        attempts: result.params?.attempts ?? 0,
        seconds: result.params?.seconds ?? 0,
      });
    case 'PIN_INVALID':
      return translate(locale, 'auth.pin_attempts_left', {
        attempts: result.params?.attempts ?? 0,
      });
    default:
      return translate(locale, 'manager.denied');
  }
}

export function managerApprovalErrorMessage(locale: Locale, error: unknown): string {
  if (
    typeof error === 'object'
    && error !== null
    && 'code' in error
    && isTradingWebErrorCode((error as { code?: unknown }).code)
  ) {
    return translateApiErrorCode((error as { code: string }).code, locale);
  }
  return translate(locale, 'manager.denied');
}
