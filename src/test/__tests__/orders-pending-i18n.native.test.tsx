import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';
import { Pressable, Text } from 'react-native';

import type { Order } from '@/api';
import { I18nProvider, LOCALE_STORAGE_KEY, useI18n } from '@/i18n';
import type { PendingOrder } from '@/stores/pending';
import { usePending } from '@/stores/pending';
import { useSettings } from '@/stores/settings';

const mockFetchOrdersPage = jest.fn();
const mockPush = jest.fn();

jest.mock('expo-router', () => {
  const ReactModule = jest.requireActual('react');
  return {
    useRouter: () => ({
      push: mockPush,
      replace: jest.fn(),
    }),
    useFocusEffect: (callback: () => void | (() => void)) => {
      ReactModule.useEffect(callback, []);
    },
  };
});

jest.mock('@/api', () => {
  const actual = jest.requireActual('@/api');
  return {
    ...actual,
    getDataSource: () => ({
      fetchOrdersPage: mockFetchOrdersPage,
    }),
  };
});

// eslint-disable-next-line import/first
import Orders from '../../../app/(tabs)/orders';
// eslint-disable-next-line import/first
import Pending from '../../../app/pending';

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
    <I18nProvider>
      <LocaleSwitch />
      {ui}
    </I18nProvider>,
  );
}

const order: Order = {
  id: 'order-1',
  number: 'POS-1001',
  createdAt: '2026-07-29T10:00:00.000Z',
  source: 'pos',
  staffName: 'Clerk',
  customerId: null,
  customerName: null,
  note: null,
  items: [],
  itemCount: 2,
  subtotalCents: 1200,
  discountCents: 0,
  taxCents: 0,
  totalCents: 1200,
  payments: [],
  status: 'completed',
  refundedCents: 0,
};

const pendingOrder: PendingOrder = {
  id: 'pending-1',
  idempotencyKey: 'idem-42',
  requestHash: 'hash-1',
  request: {
    clientRef: 'idem-42',
    staffId: 'staff-1',
    staffName: 'Clerk',
    customerId: null,
    customerName: null,
    note: null,
    currency: 'MZN',
    items: [],
    discount: null,
    subtotalCents: 1200,
    discountCents: 0,
    taxCents: 0,
    totalCents: 1200,
    payments: [],
  },
  status: 'blocked',
  createdAt: '2026-07-29T10:00:00.000Z',
  firstError: {
    message: 'server secret',
    status: 409,
    code: 'IDEMPOTENCY_CONFLICT',
    retryable: false,
    occurredAt: '2026-07-29T10:00:01.000Z',
  },
  lastError: {
    message: 'server secret',
    status: 409,
    code: 'IDEMPOTENCY_CONFLICT',
    retryable: false,
    occurredAt: '2026-07-29T10:00:01.000Z',
  },
  attempts: 1,
  lastAttemptAt: '2026-07-29T10:00:01.000Z',
  serverOrderId: null,
};

describe('orders and pending localized presentation', () => {
  beforeEach(async () => {
    await AsyncStorage.setItem(LOCALE_STORAGE_KEY, JSON.stringify('en'));
    useSettings.setState({ currency: 'USD', dataSource: 'tradingweb' });
    usePending.setState({ items: [], syncing: false });
    mockFetchOrdersPage.mockResolvedValue({
      items: [order],
      page: 1,
      pageSize: 50,
      total: 1,
      hasMore: false,
    });
  });

  it('renders order status and screen labels in English and Portuguese', async () => {
    const view = await renderWithI18n(<Orders />);

    await waitFor(() => expect(view.getByText('Orders')).toBeTruthy());
    expect(view.getByText('Completed')).toBeTruthy();
    await act(async () => {
      fireEvent.press(view.getByTestId('set-portuguese'));
    });
    await waitFor(() => expect(view.getByText('Pedidos')).toBeTruthy());
    expect(view.getByText('Concluído')).toBeTruthy();
    expect(view.getByPlaceholderText('Buscar número do pedido / cliente')).toBeTruthy();
  });

  it('localizes pending recovery and never renders server free text', async () => {
    usePending.setState({ items: [pendingOrder], syncing: false });
    const view = await renderWithI18n(<Pending />);

    await waitFor(() =>
      expect(
        view.getByText(
        'Server conflict: order idem-42 was not confirmed. Verify it on the server.',
        ),
      ).toBeTruthy(),
    );
    expect(view.queryByText('server secret')).toBeNull();
    const queueBeforeLocaleChange = usePending.getState().items;
    await act(async () => {
      fireEvent.press(view.getByTestId('set-portuguese'));
    });
    await waitFor(() =>
      expect(
        view.getByText(
        'Conflito no servidor: o pedido idem-42 não foi confirmado. Verifique-o no servidor.',
        ),
      ).toBeTruthy(),
    );
    expect(view.getByText('Excluir (abandonar envio)')).toBeTruthy();
    expect(usePending.getState().items).toBe(queueBeforeLocaleChange);
    expect(usePending.getState().items[0]).toEqual(pendingOrder);
  });
});
