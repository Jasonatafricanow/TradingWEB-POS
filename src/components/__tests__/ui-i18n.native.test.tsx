import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';
import { Pressable, Text } from 'react-native';

import { Btn, Empty, Field, Sheet, Stepper } from '@/components/ui';
import { I18nProvider, LOCALE_STORAGE_KEY, useI18n } from '@/i18n';

function LocaleSwitch() {
  const { setLocale } = useI18n();
  return (
    <Pressable
      testID="set-portuguese"
      accessibilityRole="button"
      accessibilityLabel="set-portuguese"
      onPress={() => void setLocale('pt')}
    >
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

describe('shared UI localized semantics', () => {
  let consoleError: jest.SpyInstance;

  beforeEach(async () => {
    await AsyncStorage.setItem(LOCALE_STORAGE_KEY, JSON.stringify('en'));
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('localizes component-owned semantics without changing caller callbacks', async () => {
    const onClose = jest.fn();
    const onChange = jest.fn();
    const view = await renderWithI18n(
      <>
        <Btn title="Save" loading onPress={jest.fn()} />
        <Sheet visible onClose={onClose} title="Cart"><></></Sheet>
        <Stepper value={2} onChange={onChange} min={0} />
        <Field testID="customer-input" label="Customer" value="" onChangeText={jest.fn()} />
        <Empty />
      </>,
    );

    const loadingButton = await view.findByRole('button', { name: 'Loading' });
    expect(loadingButton.props.accessibilityState).toEqual({ busy: true, disabled: true });
    await fireEvent.press(view.getByRole('button', { name: 'Close' }));
    await fireEvent.press(view.getByRole('button', { name: 'Decrease value' }));
    await fireEvent.press(view.getByRole('button', { name: 'Increase value' }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenNthCalledWith(1, 1);
    expect(onChange).toHaveBeenNthCalledWith(2, 3);
    expect(view.getByTestId('customer-input').props.accessibilityLabel).toBe('Customer');
    expect(view.getByText('No data')).toBeTruthy();

    await fireEvent.press(view.getByTestId('set-portuguese'));
    expect(await view.findByRole('button', { name: 'Carregando' })).toBeTruthy();
    expect(view.getByRole('button', { name: 'Fechar' })).toBeTruthy();
    expect(view.getByRole('button', { name: 'Diminuir valor' })).toBeTruthy();
    expect(view.getByRole('button', { name: 'Aumentar valor' })).toBeTruthy();
    expect(view.getByText('Sem dados')).toBeTruthy();
  });
});
