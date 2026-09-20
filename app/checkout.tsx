// 结账：多支付方式（含后台自定义，均记账式）/ 拆分支付 / 现金找零 / 满减与行级折扣
// -> 创建订单（TradingWEB）-> 小票打印/预览/系统分享电子小票

import { useRouter } from 'expo-router';
import React, { useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, Share, Text, View } from 'react-native';
import {
  buildLocalOrder, CreateOrderInput, errorMessage, ExchangeOrderInput,
  getDataSource, Order, OrderItem, Payment,
} from '@/api';
import { usePending } from '@/stores/pending';
import { shouldQueuePendingOrder } from '@/services/sync';
import { buildPosExchangeRequest } from '@/services/posRequests';
import { Btn, Card, Empty, Field, KV, Segment, Sheet, st } from '@/components/ui';
import { ManagerPinGate } from '@/components/ManagerPinGate';
import {
  CheckoutCustomerCard,
  CheckoutPaymentList,
  type CheckoutPayment,
} from '@/components/checkout/CheckoutPaymentList';
import { PrinterManager } from '@/hardware/printer/PrinterManager';
import { buildOrderReceipt, docToPlainText } from '@/hardware/printer/receipt';
import { auditLog } from '@/stores/audit';
import { useAuth } from '@/stores/auth';
import { useCart } from '@/stores/cart';
import { useSettings } from '@/stores/settings';
import { useShift } from '@/stores/shift';
import { colors, font } from '@/theme';
import { computeTotals, CURRENCY_SYMBOL, formatCents, lineDiscountCents, parseUserAmountToCents } from '@/utils/money';
import { useI18n } from '@/i18n';

export default function Checkout() {
  const router = useRouter();
  const { t } = useI18n();
  const cart = useCart();
  const settings = useSettings();
  const shift = useShift();
  const staff = useAuth((s) => s.currentStaff);
  const symbol = CURRENCY_SYMBOL[settings.currency];

  const totals = useMemo(
    () => computeTotals(cart.lines, cart.discount, settings.taxRateBps, settings.promoRules),
    [cart.lines, cart.discount, settings.taxRateBps, settings.promoRules]
  );

  const [payments, setPayments] = useState<CheckoutPayment[]>([]);
  const paidCents = payments.reduce((s, p) => s + p.amountCents, 0);
  // 换货抵扣：旧货价值先抵新单，抵不完的差额退还顾客（现金）
  const exchange = cart.exchange;
  const creditApplied = exchange ? Math.min(exchange.creditCents, totals.totalCents) : 0;
  const overCredit = exchange ? Math.max(0, exchange.creditCents - totals.totalCents) : 0;
  const remainingCents = Math.max(0, totals.totalCents - creditApplied - paidCents);
  // 找零按笔挂在对应现金收款上，移除某笔只清它自己的找零
  const changeCents = payments.reduce((s, p) => s + (p.changeCents ?? 0), 0);

  const [paySheet, setPaySheet] = useState<{ method: string; label: string } | null>(null);
  const [amountText, setAmountText] = useState('');
  const [refText, setRefText] = useState('');

  // 履约方式（对标 Shopify BOPIS / ship-from-store）；换货模式固定门店购买
  type Fulfillment = 'in_store' | 'pickup' | 'ship';
  const [fulfillment, setFulfillment] = useState<Fulfillment>('in_store');
  const [fContact, setFContact] = useState('');
  const [fPhone, setFPhone] = useState('');
  const [fAddress, setFAddress] = useState('');
  const [fWhen, setFWhen] = useState('');
  // 幂等键：进入结账生成一次，重试沿用同一个（服务端按 client_ref 去重，防超时重试重复建单）
  const clientRefRef = useRef(`pos-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);

  const [busy, setBusy] = useState(false);
  const [pendingExchange, setPendingExchange] = useState<ExchangeOrderInput | null>(null);
  const [exchangeGateVisible, setExchangeGateVisible] = useState(false);
  const [done, setDone] = useState<Order | null>(null);
  const [doneOffline, setDoneOffline] = useState(false);
  const [doneRefundDiff, setDoneRefundDiff] = useState(0);
  const pending = usePending();
  const [previewText, setPreviewText] = useState<string | null>(null);

  const methods = settings.paymentMethods.filter((m) => m.enabled);

  const openPay = (method: string, label: string) => {
    setAmountText((remainingCents / 100).toFixed(2));
    setRefText('');
    setPaySheet({ method, label });
  };

  const addPayment = () => {
    if (!paySheet) return;
    const entered = parseUserAmountToCents(amountText);
    if (entered === null || entered <= 0) {
      Alert.alert('提示', '请输入有效金额');
      return;
    }
    let applied = entered;
    let change = 0;
    if (paySheet.method === 'cash') {
      // 现金：可多收找零
      if (entered > remainingCents) {
        change = entered - remainingCents;
        applied = remainingCents;
      }
    } else if (entered > remainingCents) {
      Alert.alert('提示', `非现金支付不能超过剩余应收 ${formatCents(remainingCents, symbol)}`);
      return;
    }
    setPayments((ps) => [
      ...ps,
      { method: paySheet.method, label: paySheet.label, amountCents: applied, ref: refText.trim() || null, changeCents: change },
    ]);
    setPaySheet(null);
  };

  const removePayment = (idx: number) => {
    setPayments((ps) => ps.filter((_, i) => i !== idx));
  };

  const complete = () => {
    if (!staff) return;
    if (remainingCents > 0) {
      Alert.alert('提示', `还差 ${formatCents(remainingCents, symbol)} 未收`);
      return;
    }
    if (fulfillment !== 'in_store' && !exchange) {
      if (!fContact.trim() || !fPhone.trim()) {
        Alert.alert('提示', `${fulfillment === 'pickup' ? '到店自提' : '门店发货'}需填写联系人与电话`);
        return;
      }
      if (fulfillment === 'ship' && !fAddress.trim()) {
        Alert.alert('提示', '门店发货需填写收货地址');
        return;
      }
      if (fulfillment === 'pickup' && fWhen.trim()) {
        const pickupAt = Date.parse(fWhen.trim());
        if (Number.isNaN(pickupAt)) {
          Alert.alert('提示', '预计取货时间需使用 ISO 8601 格式，例如 2026-07-22T10:00:00+02:00');
          return;
        }
        if (pickupAt < Date.now()) {
          Alert.alert(t('checkout.pickup_past'));
          return;
        }
      }
    }
    if (!shift.open) {
      Alert.alert('尚未开班', '本单现金将不计入任何班次的钱箱核算。建议先开班。', [
        { text: '取消', style: 'cancel' },
        { text: '去开班', onPress: () => router.push('/shift') },
        { text: '仍要收款', style: 'destructive', onPress: () => doComplete() },
      ]);
      return;
    }
    doComplete();
  };

  const doComplete = async () => {
    if (!staff) return;
    setBusy(true);
    let input!: CreateOrderInput;
    try {
      const items: OrderItem[] = cart.lines.map((l) => ({
        productId: l.productId,
        variantId: l.variantId,
        name: l.name,
        variantLabel: l.variantLabel,
        sku: l.sku,
        unitPriceCents: l.unitPriceCents,
        qty: l.qty,
        lineDiscountCents: lineDiscountCents(l),
        deliveryMethod: exchange ? 'in_store' : fulfillment,
      }));
      const noteParts = [cart.note || null];
      if (exchange) {
        noteParts.push(`换货自 ${exchange.orderNumber}`);
        if (overCredit > 0) noteParts.push(`退差 ${formatCents(overCredit, symbol)}`);
      } else if (fulfillment === 'pickup') {
        noteParts.push(`到店自提：${fContact.trim()} ${fPhone.trim()}${fWhen.trim() ? ` 预计${fWhen.trim()}` : ''}`);
      } else if (fulfillment === 'ship') {
        noteParts.push(`门店发货：${fContact.trim()} ${fPhone.trim()} ${fAddress.trim()}`);
      }
      const allPayments: Payment[] = [
        ...(exchange && creditApplied > 0
          ? [{ method: 'exchange_credit', label: `换货抵扣（原单 ${exchange.orderNumber}）`, amountCents: creditApplied, ref: null }]
          : []),
        ...payments.map(({ changeCents: _c, ...pp }) => pp),
      ];
      input = {
        clientRef: clientRefRef.current,
        staffId: staff.id,
        staffName: staff.name,
        customerId: cart.customer?.id ?? null,
        customerName: cart.customer?.name ?? null,
        note: noteParts.filter(Boolean).join(' | ') || null,
        currency: settings.currency,
        items,
        discount: cart.discount,
        promoLabel: totals.promoLabel,
        subtotalCents: totals.subtotalCents,
        discountCents: totals.discountCents,
        taxCents: totals.taxCents,
        totalCents: totals.totalCents,
        payments: allPayments,
        // 结构化履约与客户信息
        buyerName: fulfillment !== 'in_store' && fContact.trim() ? fContact.trim() : (cart.customer?.name ?? null),
        buyerPhone: fulfillment !== 'in_store' && fPhone.trim() ? fPhone.trim() : (cart.customer?.phone ?? null),
        deliveryDate: fulfillment === 'pickup' ? fWhen.trim() : null,
        shippingAddress: fulfillment === 'ship' && fAddress.trim() ? {
          address_line1: fAddress.trim(),
          city: '',
          country: 'Moz',
        } : null,
      };

      let order: Order;
      if (exchange) {
        const exchangeRequest: ExchangeOrderInput = {
          clientRef: clientRefRef.current,
          originalOrderId: exchange.orderId,
          returnItems: exchange.items.map((it) => {
            if (!it.id) {
              throw new Error(`退回商品 ${it.name} 缺少明细 ID`);
            }
            return {
              orderItemId: it.id,
              qty: it.qty,
              restock: exchange.restock,
            };
          }),
          replacement: input,
          differencePayment: payments.map(({ changeCents: _c, ...pp }) => pp),
          approvalToken: null,
        };
        const needsApproval = settings.dataSource === 'tradingweb'
          || (settings.approvals.exchange && staff.role === 'staff');
        if (needsApproval) {
          setPendingExchange(exchangeRequest);
          setExchangeGateVisible(true);
          return;
        }
        const result = await getDataSource().exchangeOrder(exchangeRequest);
        order = result.replacementOrder;
      } else {
        order = await getDataSource().createOrder(input);
      }
      finishSale(order, false);
    } catch (e) {
      if (exchange) {
        Alert.alert('换货失败', errorMessage(e));
      } else {
        // 网络/服务器异常且已实收钱款：允许存为待同步，收银不中断；数据校验错误(400)必须人工处理
        const queueable = settings.dataSource === 'tradingweb'
          && shouldQueuePendingOrder(e);
        if (queueable) {
          Alert.alert('下单失败（网络或服务器异常）', errorMessage(e), [
            { text: '取消', style: 'cancel' },
            {
              text: '存为待同步',
              onPress: () => {
                if (!shouldQueuePendingOrder(e)) return;
                const item = pending.add(input, e);
                finishSale(buildLocalOrder(input, item.idempotencyKey), true);
              },
            },
          ]);
        } else {
          Alert.alert('下单失败', errorMessage(e));
        }
      }
    } finally {
      setBusy(false);
    }
  };

  const finishSale = (order: Order, offline: boolean, exchangeApprovedBy?: string) => {
    const cashCents = payments.filter((p) => p.method === 'cash').reduce((s, p) => s + p.amountCents, 0);
    if (shift.open) {
      shift.recordOrder(order.totalCents, cashCents);
      if (overCredit > 0) shift.recordRefund(overCredit, overCredit); // 换货退差：现金出钱箱
    } else {
      // 未开班收款：不写入班次残留状态，仅审计留痕
      auditLog('no_shift_sale', `单号 ${order.number} 金额 ${formatCents(order.totalCents, symbol)}（现金 ${formatCents(cashCents, symbol)}）`, staff?.name ?? '-');
    }
    if (exchange) {
      auditLog(
        'exchange',
        `完成换货：原单 ${exchange.orderNumber} → 新单 ${order.number}，抵扣 ${formatCents(creditApplied, symbol)}${overCredit > 0 ? `，退差 ${formatCents(overCredit, symbol)}` : ''}`,
        staff?.name ?? '-',
        exchangeApprovedBy ?? exchange.approvedBy
      );
      setDoneRefundDiff(overCredit);
    }
    if (cashCents > 0 || overCredit > 0) PrinterManager.openDrawerSilently();
    clientRefRef.current = `pos-${Date.now()}-${Math.floor(Math.random() * 1e6)}`; // 下一笔交易换新幂等键
    cart.clear();
    setDoneOffline(offline);
    setDone(order);
    if (settings.autoPrintReceipt) {
      PrinterManager.printDoc(buildOrderReceipt(order, receiptCtx())).catch(() => {});
    }
  };

  const completeApprovedExchange = async (approvalToken: string | null, approvedBy: string) => {
    if (!pendingExchange) return;
    setExchangeGateVisible(false);
    setBusy(true);
    try {
      const result = await getDataSource().exchangeOrder({
        ...pendingExchange,
        approvalToken,
      });
      setPendingExchange(null);
      finishSale(result.replacementOrder, false, approvedBy);
    } catch (error) {
      Alert.alert('换货失败', errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const receiptCtx = () => ({
    storeName: settings.store.name,
    storeAddress: settings.store.address,
    footer: settings.store.footer,
    symbol,
    widthCols: settings.printer.widthCols,
    changeCents,
  });

  const printReceipt = async (order: Order) => {
    try {
      await PrinterManager.printDoc(buildOrderReceipt(order, receiptCtx()));
    } catch (e) {
      Alert.alert('打印失败', errorMessage(e));
    }
  };

  /** 电子小票：系统分享（短信/邮件/微信等任意应用），离线可用、零后端依赖 */
  const shareReceipt = async (order: Order) => {
    try {
      const text = docToPlainText(buildOrderReceipt(order, receiptCtx()), settings.printer.widthCols);
      await Share.share({ message: text });
    } catch {
      // 用户取消分享等情况，静默
    }
  };

  // ---------- 完成页 ----------
  if (done) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, padding: 20, justifyContent: 'center' }}>
        <Card style={{ alignItems: 'center', paddingVertical: 30 }}>
          <Text style={{ fontSize: 44 }}>✅</Text>
          <Text style={{ fontSize: font.xl, fontWeight: '800', color: colors.text, marginTop: 8 }}>交易完成</Text>
          <Text style={{ color: colors.sub, marginTop: 4 }}>单号 {done.number}</Text>
          {doneOffline && (
            <Text style={{ color: colors.warn, marginTop: 6, fontWeight: '600' }}>
              ⚠ 已存为待同步（更多 → 待同步订单），钱款已实收
            </Text>
          )}
          <Text style={{ fontSize: font.xxl, fontWeight: '800', color: colors.text, marginTop: 14 }}>
            {formatCents(done.totalCents, symbol)}
          </Text>
          {changeCents > 0 && (
            <Text style={{ fontSize: font.xl, color: colors.danger, fontWeight: '700', marginTop: 6 }}>
              找零 {formatCents(changeCents, symbol)}
            </Text>
          )}
          {doneRefundDiff > 0 && (
            <Text style={{ fontSize: font.xl, color: colors.danger, fontWeight: '700', marginTop: 6 }}>
              退差额 {formatCents(doneRefundDiff, symbol)}（现金）
            </Text>
          )}
        </Card>
        <Btn title="🖨 打印小票" size="lg" onPress={() => printReceipt(done)} style={{ marginBottom: 10 }} />
        <View style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}>
          <Btn title="小票预览" kind="outline" onPress={() => setPreviewText(docToPlainText(buildOrderReceipt(done, receiptCtx()), settings.printer.widthCols))} style={{ flex: 1 }} />
          <Btn title="📤 电子小票" kind="outline" onPress={() => shareReceipt(done)} style={{ flex: 1 }} />
        </View>
        <Btn title="继续收银" kind="success" size="lg" onPress={() => router.back()} />
        <Sheet visible={previewText !== null} onClose={() => setPreviewText(null)} title="小票预览">
          <ScrollView style={{ maxHeight: 460, backgroundColor: '#fff', borderRadius: 8, padding: 12 }}>
            <Text style={{ fontFamily: 'monospace' as any, fontSize: 12, color: '#000' }}>{previewText}</Text>
          </ScrollView>
        </Sheet>
      </View>
    );
  }

  // ---------- 收款页 ----------
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 140 }}>
        <Card>
          <KV k="应收合计" v={formatCents(totals.totalCents, symbol)} bold />
          {totals.discountCents > 0 && (
            <KV
              k={`已含折扣${totals.promoLabel ? `（${totals.promoLabel}）` : ''}`}
              v={`-${formatCents(totals.discountCents, symbol)}`}
              tone="danger"
            />
          )}
          {exchange && (
            <KV k={`换货抵扣（原单 ${exchange.orderNumber}）`} v={`-${formatCents(creditApplied, symbol)}`} tone="danger" />
          )}
          <KV k="已收" v={formatCents(paidCents, symbol)} tone="success" />
          <KV k="剩余" v={formatCents(remainingCents, symbol)} bold tone={remainingCents > 0 ? 'danger' : 'success'} />
          {overCredit > 0 && <KV k="应退差额（现金）" v={formatCents(overCredit, symbol)} tone="danger" bold />}
          {changeCents > 0 && <KV k="应找零" v={formatCents(changeCents, symbol)} tone="danger" bold />}
        </Card>
        <CheckoutCustomerCard customer={cart.customer} />
        {exchange && (
          <Text style={{ color: colors.warn, fontSize: font.xs, marginBottom: 8 }}>
            换货模式：完成交易时将先对原单退货{exchange.restock ? '（回补库存）' : ''}，再以抵扣后的净额创建新单。
          </Text>
        )}

        {!exchange && (
          <Card>
            <Text style={{ color: colors.sub, fontSize: font.sm, marginBottom: 8 }}>履约方式</Text>
            <Segment<Fulfillment>
              options={[
                { value: 'in_store', label: '门店购买' },
                { value: 'pickup', label: '到店自提' },
                { value: 'ship', label: '门店发货' },
              ]}
              value={fulfillment}
              onChange={setFulfillment}
            />
            {fulfillment !== 'in_store' && (
              <>
                <Field label="联系人 *" value={fContact} onChangeText={setFContact} placeholder="顾客姓名" />
                <Field label="电话 *" value={fPhone} onChangeText={setFPhone} keyboardType="numeric" placeholder="联系电话" />
                {fulfillment === 'pickup' ? (
                  <Field label="预计取货时间（选填）" value={fWhen} onChangeText={setFWhen} placeholder="2026-07-22T10:00:00+02:00" />
                ) : (
                  <Field label="收货地址 *" value={fAddress} onChangeText={setFAddress} placeholder="省市区 + 详细地址" />
                )}
                {settings.dataSource === 'tradingweb' && (
                  <Text style={{ color: colors.warn, fontSize: font.xs }}>
                    注意：需后端把 {fulfillment} 加入 delivery_method 白名单（BACKEND_API.md §二），否则下单会被 400 拒绝。
                  </Text>
                )}
              </>
            )}
          </Card>
        )}

        <CheckoutPaymentList payments={payments} symbol={symbol} onRemove={removePayment} />

        <Text style={{ color: colors.sub, marginBottom: 8, marginTop: 4 }}>选择收款方式{payments.length > 0 ? '（可拆分继续收）' : ''}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {methods.map((m) => (
            <Pressable
              key={m.method}
              disabled={remainingCents === 0}
              onPress={() => openPay(m.method, m.label)}
              style={({ pressed }) => [st.card, {
                width: '47%',
                alignItems: 'center',
                paddingVertical: 22,
                opacity: remainingCents === 0 ? 0.4 : 1,
                backgroundColor: pressed ? colors.primarySoft : colors.card,
              }]}
            >
              <Text style={{ fontSize: font.lg, fontWeight: '700', color: colors.text }}>{m.label}</Text>
            </Pressable>
          ))}
        </View>
        {cart.lines.length === 0 && <Empty text="购物车为空" />}
      </ScrollView>

      <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: 14, paddingBottom: 20, backgroundColor: colors.card, borderTopWidth: 1, borderColor: colors.border }}>
        <Btn
          title={remainingCents > 0 ? `完成交易（还差 ${formatCents(remainingCents, symbol)}）` : '完成交易'}
          size="lg"
          kind="success"
          disabled={cart.lines.length === 0 || remainingCents > 0}
          loading={busy}
          onPress={complete}
        />
      </View>

      {/* 收款金额 */}
      <Sheet visible={!!paySheet} onClose={() => setPaySheet(null)} title={`收款 · ${paySheet?.label ?? ''}`}>
        <Field label={`金额（${symbol}）`} value={amountText} onChangeText={setAmountText} keyboardType="decimal-pad" placeholder="0.00" />
        {paySheet?.method === 'cash' && (
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            <Btn title="精确金额" kind="outline" size="sm" onPress={() => setAmountText((remainingCents / 100).toFixed(2))} />
            {[100, 200, 500].map((v) => (
              <Btn key={v} title={`${symbol}${v}`} kind="outline" size="sm" onPress={() => setAmountText(String(v))} />
            ))}
          </View>
        )}
        <Field
          label="凭证号 / 备注（选填）"
          value={refText}
          onChangeText={setRefText}
          placeholder={paySheet?.method === 'cash' ? '如：大钞找零 / 抹零说明' : '如刷卡小票号、转账单号、核销码'}
        />
        {paySheet?.method === 'cash' && (() => {
          const entered = parseUserAmountToCents(amountText) ?? 0;
          const change = Math.max(0, entered - remainingCents);
          return change > 0 ? (
            <Text style={{ color: colors.danger, fontWeight: '700', marginBottom: 10 }}>
              找零 {formatCents(change, symbol)}
            </Text>
          ) : null;
        })()}
        <Btn title="确认收款" onPress={addPayment} />
      </Sheet>
      <ManagerPinGate
        visible={exchangeGateVisible}
        actionLabel="换货"
        approvalMode="server"
        operation="exchange"
        resourceHash={pendingExchange && settings.storeId && settings.pricingVersion
          ? buildPosExchangeRequest(
              pendingExchange,
              settings.storeId,
              settings.pricingVersion,
            ).resourceHash
          : undefined}
        onClose={() => setExchangeGateVisible(false)}
        onApproved={(approval) => {
          void completeApprovedExchange(approval.token, approval.managerName);
        }}
      />
    </View>
  );
}
