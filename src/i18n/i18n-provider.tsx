import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  translate,
  type TranslationKey,
  type TranslationParams,
  type Translator,
} from './core/catalog';
import type { Locale } from './core/locale';
import { DEFAULT_LOCALE, readStoredLocale, writeStoredLocale } from './core/storage';

interface I18nContextValue {
  locale: Locale;
  ready: boolean;
  setLocale: (locale: Locale) => Promise<void>;
  t: Translator;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children, initialLocale }: {
  children: React.ReactNode;
  initialLocale?: Locale;
}) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale ?? DEFAULT_LOCALE);
  const [ready, setReady] = useState(initialLocale !== undefined);

  useEffect(() => {
    if (initialLocale !== undefined) return;
    let active = true;
    void readStoredLocale().then((stored) => {
      if (active) {
        setLocaleState(stored);
        setReady(true);
      }
    });
    return () => {
      active = false;
    };
  }, [initialLocale]);

  const setLocale = useCallback(async (nextLocale: Locale): Promise<void> => {
    setLocaleState(nextLocale);
    setReady(true);
    await writeStoredLocale(nextLocale);
  }, []);

  const t = useCallback(
    (<Key extends TranslationKey>(key: Key, params?: TranslationParams<Key>): string =>
      (translate as unknown as (
        locale: Locale,
        key: TranslationKey,
        params?: TranslationParams<Key>,
      ) => string)(locale, key, params)) as Translator,
    [locale],
  );

  const value = useMemo<I18nContextValue>(
    () => ({ locale, ready, setLocale, t }),
    [locale, ready, setLocale, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n must be used within I18nProvider');
  return value;
}
