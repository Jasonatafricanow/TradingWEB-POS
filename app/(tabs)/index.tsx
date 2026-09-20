// 收银台：商品网格 + 搜索 + 扫码（相机/HID 扫码枪）+ 自定义商品 + 购物车栏

import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, FlatList, Pressable, RefreshControl, Text, TextInput, useWindowDimensions, Vibration, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useShallow } from 'zustand/react/shallow';
import { errorMessage, getDataSource, Product, ProductVariant, variantLabel } from '@/api';
import { HidScannerListener } from '@/components/HidScannerListener';
import { Btn, Empty, Field, Sheet, st, Tag } from '@/components/ui';
import { ProductGridItem } from '@/components/register/ProductGridItem';
import { LOW_END_LIST_PROPS } from '@/components/listPolicy';
import { ScannerHub } from '@/hardware/scanner/ScannerHub';
import {
  dataSourceLabel,
  formatPosMoney,
  scannerSourceLabel,
  useI18n,
} from '@/i18n';
import { useAuth } from '@/stores/auth';
import { cartItemCount, useCart } from '@/stores/cart';
import { useSettings } from '@/stores/settings';
import { useShift } from '@/stores/shift';
import { colors, font } from '@/theme';
import { computeTotals, CURRENCY_SYMBOL, parseUserAmountToCents } from '@/utils/money';
import { createLatestRequestGuard } from '@/services/latestRequest';

export default function Register() {
  const router = useRouter();
  const { locale, t } = useI18n();
  const { width } = useWindowDimensions();
  const cart = useCart(useShallow((state) => ({
    lines: state.lines,
    discount: state.discount,
    holds: state.holds,
    exchange: state.exchange,
    addProduct: state.addProduct,
    addCustom: state.addCustom,
  })));
  const settings = useSettings(useShallow((state) => ({
    currency: state.currency,
    taxRateBps: state.taxRateBps,
    promoRules: state.promoRules,
    hidScannerEnabled: state.hidScannerEnabled,
    store: state.store,
    dataSource: state.dataSource,
  })));
  const shiftOpen = useShift((s) => s.open);
  const staff = useAuth((s) => s.currentStaff);
  const symbol = CURRENCY_SYMBOL[settings.currency];

  const [products, setProducts] = useState<Product[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [variantSheet, setVariantSheet] = useState<Product | null>(null);
  const [customSheet, setCustomSheet] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customPrice, setCustomPrice] = useState('');
  const requestGuard = useRef(createLatestRequestGuard()).current;
  const addProduct = cart.addProduct;

  const load = useCallback(
    async (q: string) => {
      const request = requestGuard.begin();
      setLoading(true);
      try {
        const result = await getDataSource().fetchProducts(q);
        if (requestGuard.isCurrent(request)) setProducts(result);
      } catch (e) {
        if (requestGuard.isCurrent(request)) Alert.alert(t('catalog.load_failed_title'), errorMessage(e));
      } finally {
        if (requestGuard.isCurrent(request)) setLoading(false);
      }
    },
    [requestGuard, t]
  );

  useEffect(() => {
    const t = setTimeout(() => load(query), query ? 300 : 0);
    return () => clearTimeout(t);
  }, [query, load]);

  const addToCart = useCallback(
    (p: Product, v: ProductVariant | null) => {
      const ok = addProduct(p, v);
      if (!ok) {
        Alert.alert(
          t('catalog.cannot_add_title'),
          t('catalog.unpriced_body', {
            product: p.name,
            variant: v ? ` (${variantLabel(v)})` : '',
          }),
        );
        return;
      }
      Vibration.vibrate(30);
    },
    [addProduct, t]
  );

  const onPressProduct = useCallback((p: Product) => {
    if (p.hasVariants) setVariantSheet(p);
    else addToCart(p, null);
  }, [addToCart]);

  // 扫码结果（相机 / HID 扫码枪 / BLE 统一入口）
  useEffect(() => {
    return ScannerHub.subscribe(async ({ data, source }) => {
      try {
        const hit = await getDataSource().findByBarcode(data);
        if (!hit) {
          Vibration.vibrate([0, 60, 80, 60]);
          Alert.alert(
            t('catalog.barcode_not_found_title'),
            t('catalog.barcode_not_found_body', {
              barcode: data,
              source: scannerSourceLabel(locale, source),
            }),
          );
          return;
        }
        if (!hit.variant && hit.product.hasVariants) {
          setVariantSheet(hit.product); // 扫到产品级条码但有变体：让收银员选规格
          return;
        }
        addToCart(hit.product, hit.variant);
      } catch (e) {
        Alert.alert(t('catalog.scan_failed_title'), errorMessage(e));
      }
    });
  }, [addToCart, locale, t]);

  const totals = useMemo(
    () => computeTotals(cart.lines, cart.discount, settings.taxRateBps, settings.promoRules),
    [cart.lines, cart.discount, settings.taxRateBps, settings.promoRules]
  );
  const count = cartItemCount(cart.lines);
  const cols = width >= 700 ? 4 : width >= 480 ? 3 : 2;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <HidScannerListener enabled={settings.hidScannerEnabled} />

      {/* 顶栏 */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: font.lg, fontWeight: '800', color: colors.text }}>{settings.store.name}</Text>
          <View style={{ flexDirection: 'row', gap: 6, marginTop: 2, alignItems: 'center' }}>
            <Text style={{ color: colors.sub, fontSize: font.xs }}>{staff?.name ?? '-'}</Text>
            <Tag text={dataSourceLabel(locale, settings.dataSource)} tone={settings.dataSource === 'tradingweb' ? 'primary' : 'warn'} />
            {!shiftOpen && <Tag text={t('catalog.shift_closed')} tone="danger" />}
            {cart.exchange && (
              <Tag
                text={t('catalog.exchange_badge', {
                  amount: formatPosMoney(locale, cart.exchange.creditCents, settings.currency),
                })}
                tone="warn"
              />
            )}
          </View>
        </View>
        {settings.dataSource === 'mock' && (
          <Pressable onPress={() => setCustomSheet(true)} style={{ padding: 8 }} hitSlop={6}>
            <Ionicons name="add-circle-outline" size={26} color={colors.text} />
          </Pressable>
        )}
        <Pressable onPress={() => router.push('/scanner')} style={{ padding: 8 }} hitSlop={6}>
          <Ionicons name="scan" size={24} color={colors.text} />
        </Pressable>
      </View>

      {/* 搜索 */}
      <View style={{ paddingHorizontal: 14, marginBottom: 8 }}>
        <TextInput
          style={st.input}
          placeholder={t('catalog.search_placeholder')}
          placeholderTextColor="#9CA3AF"
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
          autoCapitalize="none"
        />
      </View>

      {/* 商品网格 */}
      <FlatList
        {...LOW_END_LIST_PROPS}
        data={products}
        key={cols}
        numColumns={cols}
        keyExtractor={(p) => String(p.id)}
        contentContainerStyle={{ paddingHorizontal: 10, paddingBottom: 120 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => load(query)} />}
        ListEmptyComponent={!loading ? <Empty text={query ? t('catalog.no_matches') : t('catalog.empty')} /> : null}
        renderItem={({ item }) => (
          <ProductGridItem
            product={item}
            columns={cols}
            locale={locale}
            currency={settings.currency}
            t={t}
            onPress={onPressProduct}
          />
        )}
      />

      {/* 底部购物车栏 */}
      <View
        style={{
          position: 'absolute', left: 0, right: 0, bottom: 0,
          flexDirection: 'row', alignItems: 'center', gap: 10,
          backgroundColor: colors.card, padding: 12, paddingBottom: 16,
          borderTopWidth: 1, borderColor: colors.border,
        }}
      >
        <Pressable onPress={() => router.push('/cart')} style={{ flex: 1 }}>
          <Text style={{ color: colors.sub, fontSize: font.sm }}>
            {t('cart.item_count', { count })}
            {cart.holds.length > 0 ? t('catalog.held_suffix', { count: cart.holds.length }) : ''}
          </Text>
          <Text style={{ color: colors.text, fontSize: font.xl, fontWeight: '800' }}>
            {formatPosMoney(locale, totals.totalCents, settings.currency)}
          </Text>
        </Pressable>
        <Btn title={t('catalog.cart_action')} kind="outline" onPress={() => router.push('/cart')} />
        <Btn title={t('catalog.checkout_action')} size="lg" disabled={count === 0} onPress={() => router.push('/checkout')} />
      </View>

      {/* 规格选择 */}
      <Sheet visible={!!variantSheet} onClose={() => setVariantSheet(null)} title={variantSheet?.name ?? ''}>
        {variantSheet?.variants.map((v) => (
          <Pressable
            key={v.id}
            onPress={() => {
              addToCart(variantSheet, v);
              setVariantSheet(null);
            }}
            style={({ pressed }) => [st.card, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: pressed ? colors.primarySoft : colors.card }]}
          >
            <View>
              <Text style={{ fontSize: font.md, fontWeight: '600', color: colors.text }}>{variantLabel(v) || t('catalog.default_variant')}</Text>
              <Text style={{ fontSize: font.xs, color: colors.sub, marginTop: 2 }}>
                {v.sku ?? '-'}{v.stock !== null ? t('catalog.stock_suffix', { count: v.stock }) : ''}
              </Text>
            </View>
            <Text style={{ fontSize: font.md, fontWeight: '700', color: colors.primary }}>
              {v.priceCents !== null ? formatPosMoney(locale, v.priceCents, settings.currency) : t('catalog.unpriced')}
            </Text>
          </Pressable>
        ))}
      </Sheet>

      {/* 自定义商品 */}
      <Sheet visible={settings.dataSource === 'mock' && customSheet} onClose={() => setCustomSheet(false)} title={t('catalog.custom_title')}>
        <Field label={t('catalog.name_label')} value={customName} onChangeText={setCustomName} placeholder={t('catalog.custom_name_placeholder')} />
        <Field label={t('catalog.unit_price_label', { currency: symbol })} value={customPrice} onChangeText={setCustomPrice} keyboardType="decimal-pad" placeholder="0.00" />
        <Btn
          title={t('catalog.add_to_cart')}
          onPress={() => {
            const cents = parseUserAmountToCents(customPrice);
            if (!customName.trim() || cents === null || cents <= 0) {
              Alert.alert(t('catalog.validation_title'), t('catalog.custom_validation'));
              return;
            }
            cart.addCustom(customName.trim(), cents);
            setCustomName('');
            setCustomPrice('');
            setCustomSheet(false);
          }}
        />
      </Sheet>
    </SafeAreaView>
  );
}
