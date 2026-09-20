// 商品 & 库存：搜索 / 库存标签 / 进入详情调整库存

import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useRef, useState } from 'react';
import { Alert, FlatList, Pressable, RefreshControl, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { errorMessage, getDataSource, Product } from '@/api';
import { Empty, st, Tag } from '@/components/ui';
import { formatPosMoney, productTypeLabel, useI18n } from '@/i18n';
import { useSettings } from '@/stores/settings';
import { colors, font } from '@/theme';
import { LOW_END_LIST_PROPS } from '@/components/listPolicy';
import { createLatestRequestGuard } from '@/services/latestRequest';

export default function Products() {
  const router = useRouter();
  const { locale, t } = useI18n();
  const settings = useSettings();
  const [products, setProducts] = useState<Product[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const requestGuard = useRef(createLatestRequestGuard()).current;

  const load = useCallback(async (q: string) => {
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
  }, [requestGuard, t]);

  useFocusEffect(
    useCallback(() => {
      load(query);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <View style={{ padding: 14, paddingBottom: 8 }}>
        <Text style={{ fontSize: font.xl, fontWeight: '800', color: colors.text, marginBottom: 10 }}>{t('catalog.products_title')}</Text>
        <TextInput
          style={st.input}
          placeholder={t('catalog.search_placeholder')}
          placeholderTextColor="#9CA3AF"
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={() => load(query)}
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
        />
      </View>
      <FlatList
        {...LOW_END_LIST_PROPS}
        data={products}
        keyExtractor={(p) => String(p.id)}
        contentContainerStyle={{ padding: 14, paddingTop: 4 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => load(query)} />}
        ListEmptyComponent={!loading ? <Empty text={t('catalog.empty')} /> : null}
        renderItem={({ item: p }) => {
          const stock = p.hasVariants ? p.variants.reduce((s, v) => s + (v.stock ?? 0), 0) : p.stock;
          return (
            <Pressable
              onPress={() => router.push({ pathname: '/product/[id]', params: { id: String(p.id) } })}
              style={({ pressed }) => [st.card, { backgroundColor: pressed ? colors.primarySoft : colors.card }]}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ fontWeight: '700', color: colors.text, flex: 1 }} numberOfLines={1}>{p.name}</Text>
                <Text style={{ fontWeight: '700', color: colors.primary }}>
                  {p.priceCents !== null
                    ? formatPosMoney(locale, p.priceCents, settings.currency)
                    : p.hasVariants
                      ? t('catalog.multi_variant')
                      : '-'}
                </Text>
              </View>
              <View style={{ flexDirection: 'row', gap: 6, marginTop: 6, alignItems: 'center' }}>
                <Tag text={productTypeLabel(locale, p.type)} />
                {p.hasVariants && <Tag text={t('catalog.product_type_count', { count: p.variants.length })} tone="primary" />}
                {stock !== null && (
                  <Tag text={t('catalog.stock_value', { count: stock })} tone={stock <= 0 ? 'danger' : stock <= 5 ? 'warn' : 'success'} />
                )}
                <Text style={{ color: colors.sub, fontSize: font.xs }}>{p.sku ?? ''}</Text>
              </View>
            </Pressable>
          );
        }}
      />
    </SafeAreaView>
  );
}
