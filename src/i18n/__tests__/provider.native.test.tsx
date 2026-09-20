import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';
import { Button, Text, View } from 'react-native';
import { I18nProvider, useI18n } from '@/i18n/i18n-provider';
import { LOCALE_STORAGE_KEY } from '@/i18n/core/storage';
import { useAuth } from '@/stores/auth';
import { useCart } from '@/stores/cart';
import { usePending } from '@/stores/pending';
import { useSettings } from '@/stores/settings';
import { useShift } from '@/stores/shift';

function Probe() {
  const { locale, ready, setLocale, t } = useI18n();
  return (
    <View>
      <Text testID="locale">{locale}</Text>
      <Text testID="ready">{String(ready)}</Text>
      <Text>{t('tabs.more')}</Text>
      <Button title="set-portuguese" onPress={() => void setLocale('pt')} />
    </View>
  );
}

describe('I18nProvider', () => {
  it('is immediately ready when an initial locale is supplied', async () => {
    const screen = await render(<I18nProvider initialLocale="en"><Probe /></I18nProvider>);

    expect(screen.getByTestId('locale').props.children).toBe('en');
    expect(screen.getByTestId('ready').props.children).toBe('true');
    expect(screen.getByText('More')).toBeTruthy();
  });

  it('hydrates a supported locale and updates mounted content live', async () => {
    await AsyncStorage.setItem(LOCALE_STORAGE_KEY, '"en"');
    const screen = await render(<I18nProvider><Probe /></I18nProvider>);

    await waitFor(() => expect(screen.getByTestId('locale').props.children).toBe('en'));
    expect(screen.getByTestId('ready').props.children).toBe('true');
    expect(screen.getByText('More')).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByText('set-portuguese'));
    });
    await waitFor(() => expect(screen.getByTestId('locale').props.children).toBe('pt'));
    expect(screen.getByText('Mais')).toBeTruthy();
    expect(await AsyncStorage.getItem(LOCALE_STORAGE_KEY)).toBe('"pt"');
  });

  it('does not mutate operational store state when language changes', async () => {
    const before = [
      useAuth.getState(),
      useCart.getState(),
      usePending.getState(),
      useSettings.getState(),
      useShift.getState(),
    ];
    const screen = await render(<I18nProvider><Probe /></I18nProvider>);
    await act(async () => {
      fireEvent.press(screen.getByText('set-portuguese'));
    });
    await waitFor(() => expect(screen.getByTestId('locale').props.children).toBe('pt'));

    expect([
      useAuth.getState(),
      useCart.getState(),
      usePending.getState(),
      useSettings.getState(),
      useShift.getState(),
    ]).toEqual(before);
  });
});
