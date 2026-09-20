import AsyncStorage from '@react-native-async-storage/async-storage';
import { isSupportedLocale, type Locale } from './locale';

export const LOCALE_STORAGE_KEY = 'twpos.locale.v1';
export const DEFAULT_LOCALE: Locale = 'zh';

export async function readStoredLocale(): Promise<Locale> {
  try {
    const raw = await AsyncStorage.getItem(LOCALE_STORAGE_KEY);
    if (raw === null) return DEFAULT_LOCALE;
    const parsed: unknown = JSON.parse(raw);
    return isSupportedLocale(parsed) ? parsed : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

export async function writeStoredLocale(locale: Locale): Promise<void> {
  if (!isSupportedLocale(locale)) {
    throw new Error(`Unsupported locale: ${String(locale)}`);
  }
  await AsyncStorage.setItem(LOCALE_STORAGE_KEY, JSON.stringify(locale));
}
