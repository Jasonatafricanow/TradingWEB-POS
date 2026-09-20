import AsyncStorage from '@react-native-async-storage/async-storage';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  readStoredLocale,
  writeStoredLocale,
} from '@/i18n/core/storage';

describe('locale preference storage', () => {
  it('uses the approved default for missing, corrupt, or unsupported values', async () => {
    expect(await readStoredLocale()).toBe(DEFAULT_LOCALE);

    await AsyncStorage.setItem(LOCALE_STORAGE_KEY, 'es');
    expect(await readStoredLocale()).toBe(DEFAULT_LOCALE);

    await AsyncStorage.setItem(LOCALE_STORAGE_KEY, '{bad json');
    expect(await readStoredLocale()).toBe(DEFAULT_LOCALE);
  });

  it('persists only a supported locale under the dedicated preference key', async () => {
    await writeStoredLocale('pt');
    expect(await AsyncStorage.getItem(LOCALE_STORAGE_KEY)).toBe('"pt"');

    await expect(writeStoredLocale('es' as never)).rejects.toThrow(/unsupported locale/i);
    expect(await AsyncStorage.getItem(LOCALE_STORAGE_KEY)).toBe('"pt"');
  });
});
