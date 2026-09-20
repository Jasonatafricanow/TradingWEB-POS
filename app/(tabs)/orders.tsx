// 订单列表：搜索 / 下拉刷新 / 状态标签

import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getDataSource, Order } from '@/api';
import { Empty, st, Tag } from '@/components/ui';
import {
  formatDateTime,
  fulfillmentStatusLabel,
  orderStatusLabel,
  useI18n,
} from '@/i18n';
import { useSettings } from '@/stores/settings';
import { colors, font } from '@/theme';
import { CURRENCY_SYMBOL, formatCents } from '@/utils/money';
import { LOW_END_LIST_PROPS } from '@/components/listPolicy';

const STATUS_TONE: Record<Order['status'], 'success' | 'warn' | 'danger'> = {
  completed: 'success',
  partial_refund: 'warn',
  refunded: 'danger',
};

export default function Orders() {
  const router = useRouter();
  const { locale, t } = useI18n();
  const settings = useSettings();
  const symbol = CURRENCY_SYMBOL[settings.currency];
  const [orders, setOrders] = useState<Order[]>([]);
  const [query, setQuery] = useState('');
  const [source, setSource] = useState<'pos' | 'all'>('pos');
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const requestSequence = useRef(0);
  const translatorRef = useRef(t);
  translatorRef.current = t;

  const load = useCallback(async (q: string, s: 'pos' | 'all', nextPage = 1) => {
    const requestId = ++requestSequence.current;
    if (nextPage === 1) setLoading(true);
    else setLoadingMore(true);
    try {
      const result = await getDataSource().fetchOrdersPage({ page: nextPage, pageSize: 50, source: s, search: q });
      if (requestId !== requestSequence.current) return;
      setOrders((existing) => nextPage === 1
        ? result.items
        : [...existing, ...result.items.filter((item) => !existing.some((current) => current.id === item.id))]);
      setPage(result.page);
      setHasMore(result.hasMore);
    } catch {
      if (requestId === requestSequence.current) {
        Alert.alert(
          translatorRef.current('orders.load_failed_title'),
          translatorRef.current('orders.load_failed_body'),
        );
      }
    } finally {
      if (requestId === requestSequence.current) {
        if (nextPage === 1) setLoading(false);
        else setLoadingMore(false);
      }
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load(query, source, 1);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
  );

  useEffect(() => {
    const t = setTimeout(() => load(query, source, 1), 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, source]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <View style={{ padding: 14, paddingBottom: 8 }}>
        <Text style={{ fontSize: font.xl, fontWeight: '800', color: colors.text, marginBottom: 10 }}>{t('orders.title')}</Text>
        <TextInput
          style={st.input}
          placeholder={t('orders.search_placeholder')}
          placeholderTextColor="#9CA3AF"
          value={query}
          onChangeText={(t) => {
            setQuery(t);
          }}
          onSubmitEditing={() => load(query, source, 1)}
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
        />
        <View style={{ flexDirection: 'row', marginTop: 12, gap: 10 }}>
          <Pressable onPress={() => setSource('pos')} style={{ paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16, backgroundColor: source === 'pos' ? colors.primary : colors.card }}>
            <Text style={{ color: source === 'pos' ? '#fff' : colors.text, fontSize: font.sm, fontWeight: '600' }}>{t('orders.source_pos')}</Text>
          </Pressable>
          <Pressable onPress={() => setSource('all')} style={{ paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16, backgroundColor: source === 'all' ? colors.primary : colors.card }}>
            <Text style={{ color: source === 'all' ? '#fff' : colors.text, fontSize: font.sm, fontWeight: '600' }}>{t('orders.source_all')}</Text>
          </Pressable>
        </View>
      </View>
      <FlatList
        {...LOW_END_LIST_PROPS}
        data={orders}
        keyExtractor={(o) => o.id}
        contentContainerStyle={{ padding: 14, paddingTop: 4 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => load(query, source, 1)} />}
        onEndReached={() => { if (hasMore && !loading && !loadingMore) void load(query, source, page + 1); }}
        onEndReachedThreshold={0.4}
        ListFooterComponent={loadingMore ? <ActivityIndicator color={colors.primary} style={{ paddingVertical: 16 }} /> : null}
        ListEmptyComponent={!loading ? <Empty text={t('orders.empty')} /> : null}
        renderItem={({ item: o }) => {
          return (
            <Pressable
              onPress={() => router.push({ pathname: '/order/[id]', params: { id: o.id } })}
              style={({ pressed }) => [st.card, { backgroundColor: pressed ? colors.primarySoft : colors.card }]}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ fontWeight: '700', color: colors.text, fontSize: font.md }}>{o.number}</Text>
                <Text style={{ fontWeight: '800', color: colors.text, fontSize: font.md }}>{formatCents(o.totalCents, symbol)}</Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
                <Text style={{ color: colors.sub, fontSize: font.xs }}>
                  {formatDateTime(locale, new Date(o.createdAt), {
                    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                  })} · {t('orders.item_count', { count: o.itemCount })}
                  {o.customerName ? ` · ${o.customerName}` : ''}{o.staffName ? ` · ${o.staffName}` : ''}
                </Text>
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  {o.pickupStoreId ? (
                    <Tag
                      text={t('orders.pickup_status', {
                        status: fulfillmentStatusLabel(
                          locale,
                          o.fulfillmentStatus ?? 'unfulfilled',
                        ),
                      })}
                      tone={o.fulfillmentStatus === 'picked_up' ? 'success' : 'warn'}
                    />
                  ) : null}
                  <Tag text={orderStatusLabel(locale, o.status)} tone={STATUS_TONE[o.status]} />
                </View>
              </View>
            </Pressable>
          );
        }}
      />
    </SafeAreaView>
  );
}
