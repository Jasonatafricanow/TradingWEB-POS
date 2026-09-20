import { act, render, waitFor } from '@testing-library/react-native';
import React from 'react';

const mockGetUsableOperatorSessionStaffId = jest.fn();
const mockLoadOperatorSession = jest.fn();

jest.mock('expo-router', () => {
  const Stack = Object.assign(
    function MockStack() { return null; },
    { Screen: function MockStackScreen() { return null; } },
  );
  return { Stack, usePathname: () => '/', useRouter: () => ({ replace: jest.fn() }) };
});

jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));

jest.mock('@/services/operatorSession', () => ({
  getUsableOperatorSessionStaffId: () => mockGetUsableOperatorSessionStaffId(),
  loadOperatorSession: () => mockLoadOperatorSession(),
}));

// eslint-disable-next-line import/first
import RootLayout from '../../../app/_layout';
// eslint-disable-next-line import/first
import { useAuth } from '@/stores/auth';
// eslint-disable-next-line import/first
import { usePending } from '@/stores/pending';
// eslint-disable-next-line import/first
import { useSettings } from '@/stores/settings';
// eslint-disable-next-line import/first
import { useShift } from '@/stores/shift';

describe('pending auto-sync schedule', () => {
  beforeEach(async () => {
    jest.useFakeTimers();
    await Promise.all([
      useAuth.persist.rehydrate(),
      usePending.persist.rehydrate(),
      useSettings.persist.rehydrate(),
    ]);
    useAuth.setState({
      token: 'account-token',
      tokenLoaded: true,
      locked: false,
      currentStaff: { id: 'staff-1' } as any,
      loadToken: jest.fn(),
    });
    useSettings.setState({ dataSource: 'tradingweb' });
    usePending.setState({ items: [{}] as any, syncAll: jest.fn().mockResolvedValue({ ok: 0, fail: 0 }) });
    useShift.setState({ recoverCurrentShift: jest.fn().mockResolvedValue(undefined) });
    mockGetUsableOperatorSessionStaffId.mockReturnValue('staff-1');
    mockLoadOperatorSession.mockResolvedValue({ operator: { staffId: 'staff-1' } });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('re-evaluates operator session validity before every scheduled sync', async () => {
    await render(<RootLayout />);

    await waitFor(() => expect(mockLoadOperatorSession).toHaveBeenCalled());
    await act(async () => { jest.advanceTimersByTime(3_000); });
    expect(usePending.getState().syncAll).toHaveBeenCalledTimes(1);

    mockGetUsableOperatorSessionStaffId.mockReturnValue(null);
    await act(async () => { jest.advanceTimersByTime(60_000); });

    expect(usePending.getState().syncAll).toHaveBeenCalledTimes(1);
  });
});
