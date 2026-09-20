// 订单详情：明细 / 支付 / 打印小票 / 退款 / 换货（退货抵扣 → 收银台换购 → 结账净额结算）

import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Share, Switch, Text, View } from 'react-native';
import { errorMessage, getDataSource, Order } from '@/api';
import type { RefundInput } from '@/api';
import { Btn, Card, Field, KV, SectionTitle, Sheet, Stepper } from '@/components/ui';
import { ManagerPinGate } from '@/components/ManagerPinGate';
import { auditLog } from '@/stores/audit';
import { useAuth } from '@/stores/auth';
import { useCart } from '@/stores/cart';
import type { ExchangeReturnItem } from '@/stores/cart';
import { PrinterManager } from '@/hardware/printer/PrinterManager';
import { buildOrderReceipt, docToPlainText } from '@/hardware/printer/receipt';
import { useSettings } from '@/stores/settings';
import { useShift } from '@/stores/shift';
import { buildPosRefundRequest } from '@/services/posRequests';
import { colors, font } from '@/theme';
import { CURRENCY_SYMBOL, formatCents, proratedCredit } from '@/utils/money';

export default function OrderDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const settings = useSettings();
  const shift = useShift();
  const cart = useCart();
  const staff = useAuth((s) => s.currentStaff);
  const symbol = CURRENCY_SYMBOL[settings.currency];

  const [order, setOrder] = useState<Order | null>(null);
  const [previewText, setPreviewText] = useState<string | null>(null);

  const [refundSheet, setRefundSheet] = useState(false);
  const [refundQty, setRefundQty] = useState<Record<number, number>>({});
  const [refundReason, setRefundReason] = useState('');
  const [restock, setRestock] = useState(true);
  const [cashRefund, setCashRefund] = useState(false);
  const [busy, setBusy] = useState(false);
  const [gateVisible, setGateVisible] = useState(false);
  const [pendingRefund, setPendingRefund] = useState<RefundInput | null>(null);
  const refundClientRef = useRef(`refund-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);

  // 换货
  const [exchangeSheet, setExchangeSheet] = useState(false);
  const [retQty, setRetQty] = useState<Record<number, number>>({});
  const [exRestock, setExRestock] = useState(true);

  const load = useCallback(async () => {
    try {
      setOrder(await getDataSource().fetchOrder(String(id)));
    } catch (e) {
      Alert.alert('加载失败', errorMessage(e));
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (!order) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  const remainRefundable = order.totalCents - order.refundedCents;
  const refundTotalQty = Object.values(refundQty).reduce((sum, qty) => sum + qty, 0);
  const refundGrossCents = order.items.reduce(
    (sum, item, index) => sum + (refundQty[index] ?? 0) * item.unitPriceCents,
    0,
  );
  const refundEstimate = Math.min(
    proratedCredit(refundGrossCents, order.subtotalCents, order.totalCents),
    remainRefundable,
  );
  const ctx = {
    storeName: settings.store.name,
    storeAddress: settings.store.address,
    footer: settings.store.footer,
    symbol,
    widthCols: settings.printer.widthCols,
    copyLabel: '重印',
  };

  const requestRefund = () => {
    if (refundTotalQty <= 0 || refundEstimate <= 0) {
      Alert.alert('提示', '请选择要退回的商品数量');
      return;
    }
    const selectedItems = order.items
      .map((item, index) => ({ item, qty: refundQty[index] ?? 0 }))
      .filter(({ qty }) => qty > 0);
    const itemWithoutId = selectedItems.find(({ item }) => !item.id);
    if (itemWithoutId) {
      Alert.alert('无法退款', `退回商品 ${itemWithoutId.item.name} 缺少订单明细 ID`);
      return;
    }
    const returnItems = selectedItems.map(({ item, qty }) => ({
      orderItemId: item.id!,
      qty,
      restock,
    }));
    const input: RefundInput = {
      clientRef: refundClientRef.current,
      amountCents: refundEstimate,
      reason: refundReason.trim() || '门店退款',
      restock,
      returnItems,
      approvalToken: null,
      items: order.items
        .map((item, index) => ({ item, qty: refundQty[index] ?? 0 }))
        .filter(({ qty }) => qty > 0)
        .map(({ item, qty }) => ({ productId: item.productId, variantId: item.variantId, qty })),
    };
    const needsApproval = settings.dataSource === 'tradingweb'
      || (settings.approvals.refund && staff?.role === 'staff');
    if (needsApproval) {
      setPendingRefund(input);
      setGateVisible(true);
      return;
    }
    void doRefund(input);
  };

  // ---------- 换货 ----------

  const retTotalQty = Object.values(retQty).reduce((s, n) => s + n, 0);
  const retGrossCents = order
    ? order.items.reduce((s, it, i) => s + (retQty[i] ?? 0) * it.unitPriceCents, 0)
    : 0;
  // 抵扣额按实付比例摊销（整单折扣/满减/税已反映在 total 中），不再按原价全额抵扣，
  // 否则打折订单退货会超额退款。
  const retCreditRaw = order ? proratedCredit(retGrossCents, order.subtotalCents, order.totalCents) : 0;
  const exchangeCredit = Math.min(retCreditRaw, remainRefundableSafe());

  function remainRefundableSafe(): number {
    return order ? order.totalCents - order.refundedCents : 0;
  }

  const openExchange = () => {
    if (!order || order.items.length === 0) {
      Alert.alert('无法换货', '该订单没有商品明细（后端未返回 items）');
      return;
    }
    setRetQty({});
    setExRestock(true);
    setExchangeSheet(true);
  };

  const requestExchange = () => {
    if (retTotalQty <= 0) {
      Alert.alert('提示', '请选择要退回的商品数量');
      return;
    }
    startExchangeFlow();
  };

  const startExchangeFlow = () => {
    if (!order) return;
    const items: ExchangeReturnItem[] = order.items
      .map((it, i) => ({ it, q: retQty[i] ?? 0 }))
      .filter((x) => x.q > 0)
      .map((x) => ({
        id: x.it.id,
        productId: x.it.productId,
        variantId: x.it.variantId,
        name: x.it.name,
        variantLabel: x.it.variantLabel,
        sku: x.it.sku,
        unitPriceCents: x.it.unitPriceCents,
        qty: x.q,
      }));
    const credit = exchangeCredit;
    const proceed = () => {
      cart.clear();
      cart.startExchange({
        orderId: order.id,
        orderNumber: order.number,
        creditCents: credit,
        restock: exRestock,
        items,
        approvedBy: null,
      });
      auditLog(
        'exchange',
        `发起换货：原单 ${order.number} 退 ${retTotalQty} 件，抵扣 ${formatCents(credit, symbol)}`,
        staff?.name ?? '-',
        undefined
      );
      setExchangeSheet(false);
      router.replace('/(tabs)');
    };
    if (cart.lines.length > 0) {
      Alert.alert('购物车有商品', '开始换货将清空当前购物车', [
        { text: '取消' },
        { text: '清空并换货', style: 'destructive', onPress: proceed },
      ]);
    } else {
      proceed();
    }
  };

  const doRefund = async (input: RefundInput, approvedBy?: string) => {
    setBusy(true);
    try {
      const updated = await getDataSource().refundOrder(order.id, input);
      // 幂等重放：服务端按 clientRef 去重返回相同 refundedCents 时 delta 为 0，
      // 不能再按 input.amountCents 重复入账（否则钱箱会双倍出账）。
      const deltaCents = Math.max(0, updated.refundedCents - order.refundedCents);
      const replayed = deltaCents === 0;
      const refundedCents = replayed ? input.amountCents : deltaCents;
      if (!replayed && shift.open) {
        shift.recordRefund(refundedCents, cashRefund ? refundedCents : 0);
      }
      auditLog(
        'refund',
        `订单 ${order.number} 退款 ${formatCents(refundedCents, symbol)}${cashRefund ? '（现金）' : ''}${restock ? '，回补库存' : ''}${replayed ? '（服务端幂等重放，钱箱不重复入账）' : ''}${!replayed && !shift.open ? '（未开班，不计入班次）' : ''}`,
        staff?.name ?? '-',
        approvedBy
      );
      setOrder(updated);
      setRefundSheet(false);
      setPendingRefund(null);
      refundClientRef.current = `refund-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
      Alert.alert('退款成功', `已退 ${formatCents(refundedCents, symbol)}${cashRefund ? '（现金）' : ''}`);
    } catch (e) {
      Alert.alert('退款失败', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const pickupNext = order.pickupStoreId
    ? ({ unfulfilled: 'preparing', preparing: 'ready', ready: 'picked_up' } as const)[order.fulfillmentStatus as 'unfulfilled' | 'preparing' | 'ready']
    : undefined;

  const advancePickup = async () => {
    if (!pickupNext) return;
    setBusy(true);
    try {
      await getDataSource().updatePickupFulfillment(order.id, pickupNext);
      await load();
    } catch (e) {
      Alert.alert('更新自提状态失败', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 60 }}>
      <Card>
        <KV k="单号" v={order.number} bold />
        <KV k="时间" v={new Date(order.createdAt).toLocaleString()} />
        <KV k="来源" v={order.source === 'pos' ? '门店 POS' : '线上'} />
        {order.staffName ? <KV k="收银员" v={order.staffName} /> : null}
        {order.customerName ? <KV k="客户" v={order.customerName} /> : null}
        {order.note ? <KV k="备注" v={order.note} /> : null}
      </Card>

      {order.pickupStoreId ? (
        <>
          <SectionTitle text="自提履约" />
          <Card>
            <KV k="状态" v={order.fulfillmentStatus ?? 'unfulfilled'} bold />
            {order.pickupContactName ? <KV k="联系人" v={order.pickupContactName} /> : null}
            {order.pickupPhone ? <KV k="电话" v={order.pickupPhone} /> : null}
            {order.pickupReadyAt ? <KV k="备妥时间" v={new Date(order.pickupReadyAt).toLocaleString()} /> : null}
            {order.pickedUpAt ? <KV k="取货时间" v={new Date(order.pickedUpAt).toLocaleString()} /> : null}
            {pickupNext ? <Btn title={`推进为 ${pickupNext}`} disabled={busy} onPress={() => void advancePickup()} style={{ marginTop: 10 }} /> : null}
          </Card>
        </>
      ) : null}

      <SectionTitle text={`商品明细（${order.itemCount} 件）`} />
      <Card>
        {order.items.length === 0 ? (
          <Text style={{ color: colors.sub }}>后端未返回明细（重印小票将只含金额汇总）</Text>
        ) : (
          order.items.map((it, i) => (
            <View key={i} style={{ paddingVertical: 6, borderBottomWidth: i === order.items.length - 1 ? 0 : 1, borderColor: colors.border }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: colors.text, fontWeight: '600', flex: 1 }} numberOfLines={2}>{it.name}</Text>
                <Text style={{ color: colors.text, fontWeight: '700' }}>{formatCents(it.unitPriceCents * it.qty, symbol)}</Text>
              </View>
              <Text style={{ color: colors.sub, fontSize: font.xs, marginTop: 2 }}>
                {[it.variantLabel, it.sku].filter(Boolean).join(' | ')}{it.variantLabel || it.sku ? ' · ' : ''}
                {formatCents(it.unitPriceCents, symbol)} × {it.qty}
              </Text>
            </View>
          ))
        )}
      </Card>

      <SectionTitle text="金额" />
      <Card>
        <KV k="小计" v={formatCents(order.subtotalCents, symbol)} />
        {order.discountCents > 0 && <KV k="折扣" v={`-${formatCents(order.discountCents, symbol)}`} tone="danger" />}
        {order.taxCents > 0 && <KV k="税费" v={formatCents(order.taxCents, symbol)} />}
        <KV k="合计" v={formatCents(order.totalCents, symbol)} bold />
        {order.payments.map((p, i) => (
          <KV key={i} k={p.label + (p.ref ? `（${p.ref}）` : '')} v={formatCents(p.amountCents, symbol)} />
        ))}
        {order.refundedCents > 0 && <KV k="已退款" v={`-${formatCents(order.refundedCents, symbol)}`} tone="danger" bold />}
      </Card>

      <View style={{ gap: 10, marginTop: 8 }}>
        <Btn title="🖨 打印小票" onPress={async () => {
          try {
            await PrinterManager.printDoc(buildOrderReceipt(order, ctx));
          } catch (e) {
            Alert.alert('打印失败', errorMessage(e));
          }
        }} />
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Btn title="小票预览" kind="outline" onPress={() => setPreviewText(docToPlainText(buildOrderReceipt(order, ctx), settings.printer.widthCols))} style={{ flex: 1 }} />
          <Btn
            title="📤 电子小票"
            kind="outline"
            style={{ flex: 1 }}
            onPress={async () => {
              try {
                await Share.share({ message: docToPlainText(buildOrderReceipt(order, ctx), settings.printer.widthCols) });
              } catch {
                // 用户取消分享，静默
              }
            }}
          />
        </View>
        {remainRefundable > 0 && order.items.length > 0 && (
          <Btn title="↔ 换货（退旧换新一单完成）" kind="outline" onPress={openExchange} />
        )}
        {remainRefundable > 0 && (
          <Btn
            title={`退款（可退 ${formatCents(remainRefundable, symbol)}）`}
            kind="danger"
            onPress={() => {
              setRefundQty({});
              setRefundReason('');
              setRefundSheet(true);
            }}
          />
        )}
      </View>

      <Sheet visible={previewText !== null} onClose={() => setPreviewText(null)} title="小票预览">
        <ScrollView style={{ maxHeight: 460, backgroundColor: '#fff', borderRadius: 8, padding: 12 }}>
          <Text style={{ fontFamily: 'monospace' as any, fontSize: 12, color: '#000' }}>{previewText}</Text>
        </ScrollView>
      </Sheet>

      <Sheet visible={refundSheet} onClose={() => setRefundSheet(false)} title={`退款 · ${order.number}`}>
        <ScrollView style={{ maxHeight: 260 }}>
          {order.items.map((item, index) => (
            <View key={item.id ?? index} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 }}>
              <Text style={{ color: colors.text, flex: 1 }}>{item.name}</Text>
              <Stepper
                value={refundQty[index] ?? 0}
                onChange={(qty) => setRefundQty((current) => ({
                  ...current,
                  [index]: Math.max(0, Math.min(item.qty, qty)),
                }))}
              />
            </View>
          ))}
        </ScrollView>
        <KV k={`退 ${refundTotalQty} 件，预计退款`} v={formatCents(refundEstimate, symbol)} bold tone="danger" />
        <Field label="退款原因" value={refundReason} onChangeText={setRefundReason} placeholder="如：商品瑕疵 / 客户改主意" />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <Text style={{ color: colors.text, fontSize: font.md }}>退货回补库存</Text>
          <Switch value={restock} onValueChange={setRestock} />
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <Text style={{ color: colors.text, fontSize: font.md }}>以现金退款（记入钱箱）</Text>
          <Switch value={cashRefund} onValueChange={setCashRefund} />
        </View>
        <Btn title="确认退款" kind="danger" loading={busy} onPress={requestRefund} />
      </Sheet>

      {/* 换货：选择退回商品 */}
      <Sheet visible={exchangeSheet} onClose={() => setExchangeSheet(false)} title={`换货 · ${order.number}`}>
        <ScrollView style={{ maxHeight: 320 }}>
          {order.items.map((it, i) => (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: i === order.items.length - 1 ? 0 : 1, borderColor: colors.border }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontWeight: '600' }} numberOfLines={1}>{it.name}</Text>
                <Text style={{ color: colors.sub, fontSize: font.xs, marginTop: 2 }}>
                  {[it.variantLabel, it.sku].filter(Boolean).join(' | ')}{it.variantLabel || it.sku ? ' · ' : ''}
                  {formatCents(it.unitPriceCents, symbol)} × 已购 {it.qty}
                </Text>
              </View>
              <Stepper
                value={retQty[i] ?? 0}
                onChange={(q) => setRetQty((m) => ({ ...m, [i]: Math.max(0, Math.min(it.qty, q)) }))}
              />
            </View>
          ))}
        </ScrollView>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginVertical: 10 }}>
          <Text style={{ color: colors.text, fontSize: font.md }}>退回商品回补库存</Text>
          <Switch value={exRestock} onValueChange={setExRestock} />
        </View>
        <KV k={`退 ${retTotalQty} 件，可抵扣`} v={formatCents(exchangeCredit, symbol)} bold tone="danger" />
        {retCreditRaw > remainRefundableSafe() && (
          <Text style={{ color: colors.warn, fontSize: font.xs, marginBottom: 8 }}>
            抵扣额已按剩余可退 {formatCents(remainRefundableSafe(), symbol)} 封顶（原单已有退款）
          </Text>
        )}
        <Text style={{ color: colors.sub, fontSize: font.xs, marginBottom: 10 }}>
          下一步：回收银台加入换购商品，结账时自动抵扣；差价多退少补。
        </Text>
        <Btn title="开始换货（去选换购商品）" onPress={requestExchange} />
      </Sheet>

      <ManagerPinGate
        visible={gateVisible}
        actionLabel="订单退款"
        approvalMode="server"
        operation="refund"
        resourceHash={pendingRefund && settings.storeId
          ? buildPosRefundRequest(order.id, pendingRefund, settings.storeId).resourceHash
          : undefined}
        onClose={() => setGateVisible(false)}
        onApproved={(approval) => {
          if (!pendingRefund) return;
          void doRefund(
            { ...pendingRefund, approvalToken: approval.token },
            approval.managerName,
          );
        }}
      />
    </ScrollView>
  );
}
