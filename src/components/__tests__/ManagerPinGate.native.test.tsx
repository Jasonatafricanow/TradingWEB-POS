import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import { Alert, Pressable, Text } from 'react-native';

const mockRequestApproval = jest.fn();
const mockUnlockOperator = jest.fn();

jest.mock('@/services/operatorSession', () => ({
  requestApproval: (...args: unknown[]) => mockRequestApproval(...args),
  unlockOperator: (...args: unknown[]) => mockUnlockOperator(...args),
  getUsableOperatorSessionPermissions: () => [],
}));

// eslint-disable-next-line import/first
import { ManagerPinGate } from '../ManagerPinGate';
// eslint-disable-next-line import/first
import { useAuth } from '@/stores/auth';
// eslint-disable-next-line import/first
import { useSettings } from '@/stores/settings';
// eslint-disable-next-line import/first
import { completeTradingWebUnlock } from '@/services/posLogin';
// eslint-disable-next-line import/first
import type { PosDataSource, Staff } from '@/api/types';
// eslint-disable-next-line import/first
import { I18nProvider, useI18n } from '@/i18n';

function LocaleSwitch() {
  const { setLocale } = useI18n();
  return (
    <Pressable testID="set-portuguese" onPress={() => void setLocale('pt')}>
      <Text>set-portuguese</Text>
    </Pressable>
  );
}

function renderWithI18n(ui: React.ReactElement) {
  return render(
    <I18nProvider initialLocale="en">
      <LocaleSwitch />
      {ui}
    </I18nProvider>,
  );
}

describe('ManagerPinGate', () => {
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('fails closed when no manager is available', async () => {
    const onApproved = jest.fn();
    useSettings.setState({ dataSource: 'tradingweb' });
    useAuth.setState({ staffList: [{ id: 'clerk-1', name: 'Clerk', role: 'staff', pin: null }] });

    await renderWithI18n(
      <ManagerPinGate
        visible
        actionLabel="Refund"
        approvalMode="server"
        operation="refund"
        resourceHash={'a'.repeat(64)}
        onClose={jest.fn()}
        onApproved={onApproved}
      />,
    );

    expect(onApproved).not.toHaveBeenCalled();
    expect(await screen.findByText('Manager approval · Refund')).toBeTruthy();
    expect(await screen.findByText('No approver is available')).toBeTruthy();
    expect(screen.getByTestId('manager-pin-gate-no-approver')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('set-portuguese'));
    expect(await screen.findByText('Aprovação do gerente · Refund')).toBeTruthy();
    expect(screen.getByText('Nenhum aprovador disponível')).toBeTruthy();
  });

  it('fails closed in mock mode when no manager exists (no silent auto-approve)', async () => {
    const onApproved = jest.fn();
    const onClose = jest.fn();
    useSettings.setState({ dataSource: 'mock' });
    useAuth.setState({ staffList: [{ id: 'clerk-1', name: 'Clerk', role: 'staff', pin: null }] });

    await renderWithI18n(
      <ManagerPinGate visible actionLabel="Stock" onClose={onClose} onApproved={onApproved} />,
    );

    expect(screen.getByTestId('manager-pin-gate-no-approver')).toBeTruthy();
    expect(onApproved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('returns the server token bound to the supplied operation and resource hash', async () => {
    const onApproved = jest.fn();
    mockRequestApproval.mockResolvedValue('one-time-token');
    useSettings.setState({ dataSource: 'tradingweb' });
    useAuth.setState({ staffList: [{ id: 'manager-1', name: 'Manager', role: 'manager', pin: null }] });

    await renderWithI18n(
      <ManagerPinGate
        visible
        actionLabel="Refund"
        approvalMode="server"
        operation="refund"
        resourceHash={'a'.repeat(64)}
        onClose={jest.fn()}
        onApproved={onApproved}
      />,
    );
    await fireEvent.changeText(screen.getByTestId('manager-pin-input'), '9876');
    await fireEvent.press(screen.getByTestId('manager-pin-confirm'));

    await waitFor(() => expect(mockRequestApproval).toHaveBeenCalledWith(
      'refund', 'a'.repeat(64), 'manager-1', '9876',
    ));
    expect(onApproved).toHaveBeenCalledWith({ token: 'one-time-token', managerName: 'Manager' });
  });

  it('keeps unsupported TradingWEB manager-gated actions explicitly fail-closed', async () => {
    const onApproved = jest.fn();
    useSettings.setState({ dataSource: 'tradingweb' });
    useAuth.setState({ staffList: [{ id: 'manager-1', name: 'Manager', role: 'manager', pin: null }] });

    await renderWithI18n(
      <ManagerPinGate visible actionLabel="Stock" onClose={jest.fn()} onApproved={onApproved} />,
    );

    expect(screen.getByTestId('manager-pin-gate-unsupported')).toBeTruthy();
    expect(await screen.findByText('This approval action is not supported by TradingWEB')).toBeTruthy();
    expect(mockRequestApproval).not.toHaveBeenCalled();
    expect(onApproved).not.toHaveBeenCalled();
  });

  it('runs login session before discovery and feeds discovered approvers into the server gate', async () => {
    const events: string[] = [];
    const clerk: Staff = { id: 'clerk-1', name: 'Clerk', role: 'staff', storeId: null, pin: null };
    const login = jest.fn(async () => {
      events.push('login');
      return { token: 'account-token', staff: clerk };
    });
    const fetchApprovers = jest.fn(async () => {
      events.push('discovery');
      return [{ id: 'manager-1', name: 'Manager', role: 'manager' as const, storeId: 'store-1', pin: null }];
    });
    const getCurrentShift = jest.fn(async () => {
      events.push('shift');
      return null;
    });
    const source = {
      kind: 'tradingweb',
      login,
      fetchApprovers,
      getCurrentShift,
      getSourceScope: () => ({
        serverUrl: 'https://example.test',
        storeId: 'store-1',
        operatorId: 'clerk-1',
        deviceId: 'device-1',
      }),
    } as unknown as PosDataSource;
    mockUnlockOperator.mockImplementation(async () => {
      events.push('session');
      return {};
    });
    useSettings.setState({ dataSource: 'tradingweb', storeId: 'store-1' });
    const account = await source.login('clerk@example.test', 'secret');
    useAuth.getState().signIn(account.token, account.staff, [account.staff]);

    await act(async () => {
      await completeTradingWebUnlock(source, clerk, '1111', 'store-1');
    });

    expect(events).toEqual(['login', 'session', 'shift', 'discovery']);
    expect(login).toHaveBeenCalledWith('clerk@example.test', 'secret');
    expect(fetchApprovers).toHaveBeenCalledWith('store-1');
    expect(useAuth.getState().staffList.map((member) => member.id)).toEqual(['clerk-1', 'manager-1']);
    expect(useAuth.getState().currentStaff?.id).toBe('clerk-1');
    expect(useAuth.getState().currentStaff?.storeId).toBe('store-1');

    mockRequestApproval.mockResolvedValue('one-time-token');
    const onApproved = jest.fn();
    await renderWithI18n(
      <ManagerPinGate
        visible
        actionLabel="Refund"
        approvalMode="server"
        operation="refund"
        resourceHash={'b'.repeat(64)}
        onClose={jest.fn()}
        onApproved={onApproved}
      />,
    );
    await fireEvent.changeText(screen.getByTestId('manager-pin-input'), '9876');
    await fireEvent.press(screen.getByTestId('manager-pin-confirm'));
    await waitFor(() => expect(mockRequestApproval).toHaveBeenCalledWith(
      'refund', 'b'.repeat(64), 'manager-1', '9876',
    ));
    expect(onApproved).toHaveBeenCalledWith({ token: 'one-time-token', managerName: 'Manager' });
  });

  it('remains fail-closed when post-session discovery returns no approver', async () => {
    const clerk: Staff = { id: 'clerk-1', name: 'Clerk', role: 'staff', storeId: 'store-1', pin: null };
    const source = {
      kind: 'tradingweb',
      getSourceScope: () => ({
        serverUrl: 'https://example.test',
        storeId: 'store-1',
        operatorId: 'clerk-1',
        deviceId: 'device-1',
      }),
      getCurrentShift: jest.fn(async () => null),
      fetchApprovers: jest.fn(async () => []),
    } as unknown as PosDataSource;
    mockUnlockOperator.mockResolvedValue({});
    useSettings.setState({ dataSource: 'tradingweb', storeId: 'store-1' });
    useAuth.getState().signIn('account-token', clerk, [clerk]);
    await act(async () => {
      await completeTradingWebUnlock(source, clerk, '1111', 'store-1');
    });

    const onApproved = jest.fn();
    await renderWithI18n(
      <ManagerPinGate
        visible
        actionLabel="Refund"
        approvalMode="server"
        operation="refund"
        resourceHash={'c'.repeat(64)}
        onClose={jest.fn()}
        onApproved={onApproved}
      />,
    );
    expect(screen.getByTestId('manager-pin-gate-no-approver')).toBeTruthy();
    expect(onApproved).not.toHaveBeenCalled();
  });

  it('does not expose unknown server error messages', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockRequestApproval.mockRejectedValue(new Error('secret server text'));
    useSettings.setState({ dataSource: 'tradingweb' });
    useAuth.setState({ staffList: [{ id: 'manager-1', name: 'Manager', role: 'manager', pin: null }] });

    await renderWithI18n(
      <ManagerPinGate
        visible
        actionLabel="Refund"
        approvalMode="server"
        operation="refund"
        resourceHash={'d'.repeat(64)}
        onClose={jest.fn()}
        onApproved={jest.fn()}
      />,
    );
    expect(await screen.findByText('Manager approval · Refund')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('manager-pin-input'), '9876');
    await fireEvent.press(screen.getByTestId('manager-pin-confirm'));

    await waitFor(() => expect(alert).toHaveBeenCalledWith(
      'Approval failed',
      'Approval was denied or could not be completed.',
    ));
    expect(alert).not.toHaveBeenCalledWith(expect.anything(), expect.stringContaining('secret'));
    alert.mockRestore();
  });
});
