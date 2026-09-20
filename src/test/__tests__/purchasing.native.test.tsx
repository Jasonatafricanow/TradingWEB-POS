import { fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';

import type { Product } from '@/api/types';
import { IDS } from '@/test/fixtures/pos';

const mockFetchProducts = jest.fn();
const mockFetchOrders = jest.fn();
const mockFetchLocations = jest.fn();
const mockFetchPurchaseOrders = jest.fn();
const mockCreatePurchaseOrder = jest.fn();
const mockCreateInventoryTransfer = jest.fn();
const mockReceivePurchaseOrder = jest.fn();

jest.mock('expo-router', () => {
  const React = jest.requireActual('react');
  return { useFocusEffect: (callback: () => void | (() => void)) => React.useEffect(callback, [callback]) };
});

jest.mock('@/api', () => {
  const actual = jest.requireActual('@/api');
  return {
    ...actual,
    getDataSource: () => ({
      kind: 'tradingweb',
      getSourceScope: () => ({
        serverUrl: 'https://example.test', storeId: '11111111-1111-4111-8111-111111111111',
        operatorId: '22222222-2222-4222-8222-222222222222', deviceId: 'android-1',
      }),
      fetchProducts: mockFetchProducts,
      fetchOrders: mockFetchOrders,
      fetchLocations: mockFetchLocations,
      fetchPurchaseOrders: mockFetchPurchaseOrders,
      createPurchaseOrder: mockCreatePurchaseOrder,
      createInventoryTransfer: mockCreateInventoryTransfer,
      receivePurchaseOrder: mockReceivePurchaseOrder,
    }),
  };
});

// eslint-disable-next-line import/first
import Purchasing from '../../../app/purchasing';
// eslint-disable-next-line import/first
import { useAuth } from '@/stores/auth';
// eslint-disable-next-line import/first
import { useSettings } from '@/stores/settings';
// eslint-disable-next-line import/first
import { I18nProvider } from '@/i18n';

function renderWithI18n(ui: React.ReactElement) {
  return render(<I18nProvider>{ui}</I18nProvider>);
}

const DEFAULT_LOCATION = '66666666-6666-4666-8666-666666666666';
const product: Product = {
  id: IDS.product, name: 'Tee', priceCents: 1000, type: 'physical', image: null,
  isActive: true, deliveryMethods: ['in_store'], hasVariants: false, variants: [],
  sku: 'TEE', barcode: null, stock: 8,
};

describe('Task 11 purchasing UI permissions and form', () => {
  beforeEach(() => {
    mockFetchProducts.mockResolvedValue([product]);
    mockFetchOrders.mockResolvedValue([]);
    mockFetchLocations.mockImplementation(async (purpose: string) => {
      if (purpose === 'purchase_order') {
        return [{ id: DEFAULT_LOCATION, name: 'Sales floor', isActive: true, isStoreDefault: true }];
      }
      if (purpose === 'inventory_transfer') {
        return [
          { id: DEFAULT_LOCATION, name: 'Sales floor', isActive: true, isStoreDefault: true },
          { id: '77777777-7777-4777-8777-777777777777', name: 'Warehouse', isActive: true, isStoreDefault: false },
        ];
      }
      throw new Error(`unexpected location purpose: ${purpose}`);
    });
    mockFetchPurchaseOrders.mockResolvedValue([]);
    useSettings.setState({ dataSource: 'tradingweb', storeId: IDS.store, currentLocationId: null });
  });

  it('fails closed for a manager lacking create, transfer, and receive permissions', async () => {
    useAuth.setState({
      currentStaff: { id: IDS.staff, name: 'Manager', role: 'manager', permissions: ['purchase_order_read'] },
    });

    const view = await renderWithI18n(<Purchasing />);
    await waitFor(() => expect(mockFetchPurchaseOrders).toHaveBeenCalled());
    expect(view.queryByTestId('new-purchase-order')).toBeNull();
    expect(view.queryByTestId('new-inventory-transfer')).toBeNull();
    expect(view.queryByText('＋ 新建采购单')).toBeNull();
    expect(view.queryByText('创建库位调拨')).toBeNull();
  });

  it('shows permitted purchasing actions and requires an explicit unit cost field', async () => {
    useAuth.setState({
      currentStaff: {
        id: IDS.staff, name: 'Admin', role: 'admin',
        permissions: ['purchase_order_read', 'purchase_order_create', 'purchase_order_receive', 'inventory_transfer'],
      },
    });

    const view = await renderWithI18n(<Purchasing />);
    await waitFor(() => expect(view.getByTestId('new-purchase-order')).toBeTruthy());
    expect(mockFetchLocations).toHaveBeenCalledWith('purchase_order');
    expect(mockFetchLocations).toHaveBeenCalledWith('inventory_transfer');
    expect(view.getByTestId('new-inventory-transfer')).toBeTruthy();
    fireEvent.press(view.getByTestId('new-purchase-order'));
    await waitFor(() => expect(view.getByTestId(`po-unit-cost-p${IDS.product}`)).toBeTruthy());
    expect(view.getByText('Sales floor')).toBeTruthy();
  });

  it('shows create and transfer actions independently when purchase-order read is denied', async () => {
    useAuth.setState({
      currentStaff: {
        id: IDS.staff, name: 'Clerk', role: 'staff',
        permissions: ['purchase_order_create', 'inventory_transfer'],
      },
    });

    const view = await renderWithI18n(<Purchasing />);
    await waitFor(() => expect(view.getByText('当前操作员无采购单查看权限')).toBeTruthy());
    expect(view.getByTestId('new-purchase-order')).toBeTruthy();
    expect(view.getByTestId('new-inventory-transfer')).toBeTruthy();
  });
});
