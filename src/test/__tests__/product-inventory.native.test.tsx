import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';

import type { Product } from '@/api/types';
import { IDS } from '@/test/fixtures/pos';

const mockAdjustStock = jest.fn();
const mockFetchProducts = jest.fn();
const mockFetchLocations = jest.fn();
const mockFetchStock = jest.fn();
let mockGateProps: any = null;

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: '33333333-3333-4333-8333-333333333333' }),
}));

jest.mock('@/api', () => {
  const actual = jest.requireActual('@/api');
  return {
    ...actual,
    getDataSource: () => ({
      kind: 'tradingweb',
      getSourceScope: () => ({
        serverUrl: 'https://example.test',
        storeId: '11111111-1111-4111-8111-111111111111',
        operatorId: '22222222-2222-4222-8222-222222222222',
        deviceId: 'android-1',
      }),
      fetchProducts: mockFetchProducts,
      fetchLocations: mockFetchLocations,
      fetchStockByLocation: mockFetchStock,
      adjustStock: mockAdjustStock,
    }),
  };
});

jest.mock('@/components/ManagerPinGate', () => ({
  ManagerPinGate: (props: any) => {
    const ReactNative = jest.requireActual('react-native');
    mockGateProps = props;
    if (!props.visible) return null;
    return (
      <ReactNative.Pressable
        testID="approve-inventory"
        onPress={() => props.onApproved({ managerName: 'Manager', token: 'approval-token' })}
      >
        <ReactNative.Text>Approve inventory</ReactNative.Text>
      </ReactNative.Pressable>
    );
  },
}));

// eslint-disable-next-line import/first
import ProductDetail from '../../../app/product/[id]';
// eslint-disable-next-line import/first
import { useAuth } from '@/stores/auth';
// eslint-disable-next-line import/first
import { useSettings } from '@/stores/settings';
// eslint-disable-next-line import/first
import { I18nProvider } from '@/i18n';

function renderWithI18n(ui: React.ReactElement) {
  return render(<I18nProvider>{ui}</I18nProvider>);
}

const LOCATION_ID = '66666666-6666-4666-8666-666666666666';
const product: Product = {
  id: IDS.product,
  name: 'Tee',
  priceCents: 1000,
  type: 'physical',
  image: null,
  isActive: true,
  deliveryMethods: ['in_store'],
  hasVariants: false,
  variants: [],
  sku: 'TEE',
  barcode: null,
  stock: 8,
};

describe('Task 11 product inventory approval', () => {
  it('binds the exact adjustment to server approval and retains the key on retry', async () => {
    mockFetchProducts.mockResolvedValue([product]);
    mockFetchLocations.mockResolvedValue([{
      id: LOCATION_ID, name: 'Sales floor', isActive: true, isStoreDefault: true,
    }]);
    mockFetchStock.mockResolvedValue([{ locationId: LOCATION_ID, locationName: 'Sales floor', stock: 8 }]);
    mockAdjustStock.mockRejectedValueOnce(new Error('temporary')).mockResolvedValueOnce(undefined);
    useSettings.setState({
      dataSource: 'tradingweb',
      storeId: IDS.store,
      currentLocationId: LOCATION_ID,
      approvals: { discount: true, refund: true, stockAdjust: true, exchange: true },
    });
    useAuth.setState({
      currentStaff: { id: IDS.staff, name: 'Clerk', role: 'staff', permissions: ['inventory_adjust'] },
      staffList: [{ id: IDS.staff, name: 'Clerk', role: 'staff', permissions: ['inventory_adjust'] }],
    });

    const view = await renderWithI18n(<ProductDetail />);
    await waitFor(() => expect(view.getByText('调整库存')).toBeTruthy());
    await act(async () => {
      fireEvent.press(view.getByText('调整库存'));
    });
    expect(mockFetchLocations).toHaveBeenCalledWith('inventory_adjustment');
    await waitFor(() => expect(view.getAllByText('Sales floor').length).toBeGreaterThan(0));
    await act(async () => {
      fireEvent.press(view.getByText('确认调整'));
    });

    await waitFor(() => expect(mockGateProps).toMatchObject({
        visible: true,
        approvalMode: 'server',
        operation: 'inventory_adjustment',
      }));
    expect(mockGateProps.resourceHash).toMatch(/^[0-9a-f]{64}$/);
    await act(async () => {
      fireEvent.press(view.getByTestId('approve-inventory'));
    });
    await waitFor(() => expect(mockAdjustStock).toHaveBeenCalledTimes(1));
    const first = mockAdjustStock.mock.calls[0][0];
    expect(first).toMatchObject({
      productId: IDS.product,
      variantId: null,
      locationId: LOCATION_ID,
      delta: 1,
      reason: 'count',
      note: null,
      approvalToken: 'approval-token',
    });
    expect(first.clientRef).toMatch(/^[0-9a-f-]{36}$/);

    await act(async () => {
      fireEvent.press(view.getByText('确认调整'));
    });
    await act(async () => {
      fireEvent.press(view.getByTestId('approve-inventory'));
    });
    await waitFor(() => expect(mockAdjustStock).toHaveBeenCalledTimes(2));
    expect(mockAdjustStock.mock.calls[1][0].clientRef).toBe(first.clientRef);
  });

  it('always requires server approval for a permitted manager even when the local switch is off', async () => {
    mockGateProps = null;
    mockFetchProducts.mockResolvedValue([product]);
    mockFetchLocations.mockResolvedValue([
      { id: LOCATION_ID, name: 'Sales floor', isActive: true, isStoreDefault: true },
      { id: '77777777-7777-4777-8777-777777777777', name: 'Warehouse', isActive: true, isStoreDefault: false },
    ]);
    mockFetchStock.mockResolvedValue([]);
    mockAdjustStock.mockResolvedValue(undefined);
    useSettings.setState({
      dataSource: 'tradingweb', storeId: IDS.store, currentLocationId: null,
      approvals: { discount: false, refund: false, stockAdjust: false, exchange: false },
    });
    useAuth.setState({
      currentStaff: { id: IDS.staff, name: 'Manager', role: 'manager', permissions: ['inventory_adjust'] },
      staffList: [],
    });

    const view = await renderWithI18n(<ProductDetail />);
    await waitFor(() => expect(view.getByTestId('adjust-inventory')).toBeTruthy());
    await act(async () => {
      fireEvent.press(view.getByTestId('adjust-inventory'));
    });
    await waitFor(() => expect(view.getByTestId(`adj-location-${LOCATION_ID}`)).toBeTruthy());
    expect(view.queryByTestId('adj-location-77777777-7777-4777-8777-777777777777')).toBeNull();
    await act(async () => {
      fireEvent.press(view.getByTestId('submit-adjustment'));
    });
    await waitFor(() => expect(mockGateProps).toMatchObject({
      visible: true,
      approvalMode: 'server',
      operation: 'inventory_adjustment',
    }));
    expect(mockAdjustStock).not.toHaveBeenCalled();
  });

  it('hides inventory adjustment in TradingWEB mode when the session lacks permission', async () => {
    mockFetchProducts.mockResolvedValue([product]);
    useSettings.setState({ dataSource: 'tradingweb', storeId: IDS.store });
    useAuth.setState({ currentStaff: { id: IDS.staff, name: 'Admin', role: 'admin', permissions: [] } });

    const view = await renderWithI18n(<ProductDetail />);
    await waitFor(() => expect(view.getByText('Tee')).toBeTruthy());
    expect(view.queryByTestId('adjust-inventory')).toBeNull();
  });
});
