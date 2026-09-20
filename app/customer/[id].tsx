// 客户档案：联系方式 / 消费统计 / 历史订单 / 设为当前交易客户
// 数据：fetchCustomerOrdersPage（TradingWEB 服务端 customer_id 过滤与分页）

import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, Text, View } from 'react-native';
import { errorMessage, getDataSource, Order } from '@/api';
import { Btn, Card, Empty, KV, SectionTitle, st, Tag } from '@/components/ui';
import { useCart } from '@/stores/cart';
import { useSettings } from '@/stores/settings';
import { colors, font } from '@/theme';
import { CURRENCY_SYMBOL, formatCents } from '@/utils/money';

const STATUS_LABEL: Record<Order['status'], { text: string; tone: 'success' | 'warn' | 'danger' }> = {
  completed: { text: '已完成', tone: 'success' },
  partial_refund: { text: '部分退款', tone: 'warn' },
  refunded: { text: '已退款', tone: 'danger' },
};

export default function CustomerProfile() {
  const { id, name, email, phone } = useLocalSearchParams<{
    id: string; name?: string; email?: string; phone?: string;
  }>();
  const router = useRouter();
  const cart = useCart();
  const settings = useSettings();
  const symbol = CURRENCY_SYMBOL[settings.currency];
  const customerId = String(id);

  const [orders, setOrders] = useState<Order[] | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const requestSequence = useRef(0);

  const load = useCallback(async (nextPage = 1) => {
    const requestId = ++requestSequence.current;
    if (nextPage > 1) setLoadingMore(true);
    try {
      const result = await getDataSource().fetchCustomerOrdersPage(customerId, { page: nextPage, pageSize: 50 });
      if (requestId !== requestSequence.current) return;
      setOrders((existing) => nextPage === 1
        ? result.items
        : [...(existing ?? []), ...result.items.filter((item) => !(existing ?? []).some((current) => current.id === item.id))]);
      setPage(result.page);
      setHasMore(result.hasMore);
    } catch (e) {
      if (requestId === requestSequence.current) {
        if (nextPage === 1) setOrders([]);
        Alert.alert('加载客户订单失败', errorMessage(e));
      }
    } finally {
      if (requestId === requestSequence.current) setLoadingMore(false);
    }
  }, [customerId]);

  useEffect(() => {
    load(1);
  }, [load]);

  const spentCents = (orders ?? []).reduce((s, o) => s + o.totalCents - o.refundedCents, 0);
  const lastAt = orders && orders.length > 0 ? orders[0].createdAt : null;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <FlatList
        data={orders ?? []}
        keyExtractor={(o) => o.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        ListHeaderComponent={
          <>
            <Card>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontSize: font.xl, fontWeight: '800', color: colors.primary }}>
                    {(name ?? '?').slice(0, 1)}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: font.lg, fontWeight: '800', color: colors.text }}>{name ?? `客户#${id}`}</Text>
                  <Text style={{ color: colors.sub, fontSize: font.xs, marginTop: 2 }}>
                    {[email, phone].filter(Boolean).join(' · ') || '无联系方式'}
                  </Text>
                </View>
              </View>
              <Btn
                title="设为当前交易客户"
                size="sm"
                style={{ marginTop: 12 }}
                onPress={() => {
                  cart.setCustomer({ id: customerId, name: String(name ?? `客户#${id}`), email: email ?? null, phone: phone ?? null });
                  router.push('/(tabs)');
                }}
              />
            </Card>

            <SectionTitle text="消费统计（基于已拉取订单）" />
            <Card>
              <KV k="历史订单" v={orders === null ? '…' : `${orders.length} 单`} />
              <KV k="累计实付（扣除退款）" v={orders === null ? '…' : formatCents(spentCents, symbol)} bold />
              <KV k="客单价" v={orders === null || orders.length === 0 ? '-' : formatCents(Math.round(spentCents / orders.length), symbol)} />
              <KV k="最近购买" v={lastAt ? new Date(lastAt).toLocaleString() : '-'} />
            </Card>

            <SectionTitle text="历史订单" />
            {orders === null && (
              <View style={{ paddingVertical: 30, alignItems: 'center' }}>
                <ActivityIndicator color={colors.primary} />
              </View>
            )}
          </>
        }
        ListEmptyComponent={orders !== null ? <Empty text="暂无历史订单" /> : null}
        onEndReached={() => { if (hasMore && !loadingMore) void load(page + 1); }}
        onEndReachedThreshold={0.4}
        ListFooterComponent={loadingMore ? <ActivityIndicator color={colors.primary} style={{ paddingVertical: 16 }} /> : null}
        renderItem={({ item: o }) => {
          const s = STATUS_LABEL[o.status];
          return (
            <Pressable
              onPress={() => router.push({ pathname: '/order/[id]', params: { id: o.id } })}
              style={({ pressed }) => [st.card, { backgroundColor: pressed ? colors.primarySoft : colors.card }]}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ fontWeight: '700', color: colors.text }}>{o.number}</Text>
                <Text style={{ fontWeight: '800', color: colors.text }}>{formatCents(o.totalCents, symbol)}</Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
                <Text style={{ color: colors.sub, fontSize: font.xs }}>
                  {new Date(o.createdAt).toLocaleString()} · {o.itemCount} 件
                </Text>
                <Tag text={s.text} tone={s.tone} />
              </View>
            </Pressable>
          );
        }}
      />
    </View>
  );
}
