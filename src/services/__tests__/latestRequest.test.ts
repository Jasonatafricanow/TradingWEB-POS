import { describe, expect, it } from 'vitest';

import { createLatestRequestGuard } from '../latestRequest';

describe('latest request guard', () => {
  it('accepts only the newest request completion', () => {
    const guard = createLatestRequestGuard();
    const first = guard.begin();
    const second = guard.begin();

    expect(guard.isCurrent(first)).toBe(false);
    expect(guard.isCurrent(second)).toBe(true);
  });

  it('invalidates an outstanding request explicitly', () => {
    const guard = createLatestRequestGuard();
    const request = guard.begin();
    guard.invalidate();
    expect(guard.isCurrent(request)).toBe(false);
  });
});
