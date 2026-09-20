import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';
import { Alert } from 'react-native';

import { CheckoutCustomerCard, CheckoutPaymentList } from '@/components/checkout/CheckoutPaymentList';
import { I18nProvider } from '@/i18n';

const payments = [{
  method: 'cash',
  label: 'Cash',
  amountCents: 1250,
  ref: 'receipt-1',
}];

describe('CheckoutPaymentList', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('shows the customer attached to the checkout', async () => {
    const view = await render(
      <I18nProvider initialLocale="en">
        <CheckoutCustomerCard customer={{
          id: 'customer-1',
          name: 'Ana',
          email: 'ana@example.test',
          phone: '+258840000000',
        }} />
      </I18nProvider>,
    );

    expect(view.getByText('Customer: Ana')).toBeTruthy();
    expect(view.getByText('+258840000000')).toBeTruthy();
  });

  it('asks for confirmation before removing a recorded payment', async () => {
    const onRemove = jest.fn();
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const view = await render(
      <I18nProvider initialLocale="en">
        <CheckoutPaymentList payments={payments} symbol="$" onRemove={onRemove} />
      </I18nProvider>,
    );

    fireEvent.press(view.getByTestId('remove-payment-0'));

    expect(onRemove).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert.mock.calls[0][0]).toBe('Remove payment?');
    expect(view.getByText('Cash (receipt-1)')).toBeTruthy();
  });

  it('keeps the payment when the confirmation is cancelled', async () => {
    const onRemove = jest.fn();
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const view = await render(
      <I18nProvider initialLocale="en">
        <CheckoutPaymentList payments={payments} symbol="$" onRemove={onRemove} />
      </I18nProvider>,
    );

    fireEvent.press(view.getByTestId('remove-payment-0'));
    const buttons = alert.mock.calls[0][2] ?? [];
    buttons[0]?.onPress?.();

    expect(onRemove).not.toHaveBeenCalled();
  });

  it('removes exactly the confirmed payment', async () => {
    const onRemove = jest.fn();
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const view = await render(
      <I18nProvider initialLocale="en">
        <CheckoutPaymentList payments={payments} symbol="$" onRemove={onRemove} />
      </I18nProvider>,
    );

    fireEvent.press(view.getByTestId('remove-payment-0'));
    const buttons = alert.mock.calls[0][2] ?? [];
    buttons[1]?.onPress?.();

    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledWith(0);
  });
});
