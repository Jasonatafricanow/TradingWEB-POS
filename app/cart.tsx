// 购物车：数量/删除、行级折扣、整单折扣、满减、备注、客户、挂单/取单、换货模式

import React, { useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Customer, errorMessage, getDataSource } from '@/api';
import { Btn, Card, Empty, Field, KV, Segment, Sheet, st, Stepper } from '@/components/ui';
import { ManagerPinGate } from '@/components/ManagerPinGate';
import { formatDateTime, formatPercent, formatPosMoney, useI18n } from '@/i18n';
import { auditLog } from '@/stores/audit';
import { useAuth } from '@/stores/auth';
import { useCart } from '@/stores/cart';
import type { CartLine } from '@/stores/cart';
import { useSettings } from '@/stores/settings';
import { colors, font } from '@/theme';
import {
  CartDiscount, computeTotals, CURRENCY_SYMBOL, formatCents, LineDiscount,
  lineDiscountCents, parseUserAmountToCents,
} from '@/utils/money';

export default function CartScreen() {
  const router = useRouter();
  const { locale, t } = useI18n();
  const cart = useCart();
  const settings = useSettings();
  const symbol = CURRENCY_SYMBOL[settings.currency];
  const totals = useMemo(
    () => computeTotals(cart.lines, cart.discount, settings.taxRateBps, settings.promoRules),
    [cart.lines, cart.discount, settings.taxRateBps, settings.promoRules]
  );

  const [discountSheet, setDiscountSheet] = useState(false);
  const [dType, setDType] = useState<'percent' | 'amount'>(cart.discount?.type ?? 'percent');
  const [dValue, setDValue] = useState(cart.discount ? String(cart.discount.type === 'amount' ? cart.discount.value / 100 : cart.discount.value) : '');

  // 行级折扣
  const [lineSheet, setLineSheet] = useState<CartLine | null>(null);
  const [ldType, setLdType] = useState<'percent' | 'amount'>('percent');
  const [ldValue, setLdValue] = useState('');

  const [noteSheet, setNoteSheet] = useState(false);
  const [noteDraft, setNoteDraft] = useState(cart.note);

  const [customerSheet, setCustomerSheet] = useState(false);
  const [customerQuery, setCustomerQuery] = useState('');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [newCustomer, setNewCustomer] = useState(false);
  const [ncName, setNcName] = useState('');
  const [ncEmail, setNcEmail] = useState('');
  const [ncPhone, setNcPhone] = useState('');

  const [holdSheet, setHoldSheet] = useState(false);
  const [holdName, setHoldName] = useState('');
  const currentStaff = useAuth((s) => s.currentStaff);
  const [gateVisible, setGateVisible] = useState(false);
  const [pendingDiscount, setPendingDiscount] = useState<CartDiscount | null>(null);
  const [pendingLine, setPendingLine] = useState<{ key: string; name: string; d: LineDiscount } | null>(null);

  const needApproval = settings.approvals.discount && currentStaff?.role === 'staff';

  const searchCustomers = async (q: string) => {
    setCustomerQuery(q);
    try {
      setCustomers(await getDataSource().fetchCustomers(q));
    } catch (e) {
      Alert.alert(t('cart.customer_load_failed_title'), errorMessage(e));
    }
  };

  const auditDiscountText = (d: LineDiscount) =>
    d.type === 'percent' ? `${d.value}%` : formatCents(d.value, symbol);
  const discountText = (d: LineDiscount) =>
    d.type === 'percent'
      ? formatPercent(locale, d.value / 100, { fractionDigits: 0 })
      : formatPosMoney(locale, d.value, settings.currency);

  const applyDiscount = () => {
    const n = parseFloat(dValue);
    if (!dValue || Number.isNaN(n) || n < 0) {
      cart.setDiscount(null);
      setDiscountSheet(false);
      return;
    }
    const d: CartDiscount =
      dType === 'percent'
        ? { type: 'percent', value: Math.min(100, n) }
        : { type: 'amount', value: parseUserAmountToCents(dValue) ?? 0 };
    const next = d.value > 0 ? d : null;
    // 店员加折扣需店长审批（设置可关）
    if (next && needApproval) {
      setPendingDiscount(next);
      setDiscountSheet(false);
      setGateVisible(true);
      return;
    }
    if (next) auditLog('discount_cart', `整单折扣 ${auditDiscountText(next)}`, currentStaff?.name ?? '-');
    cart.setDiscount(next);
    setDiscountSheet(false);
  };

  const openLineDiscount = (l: CartLine) => {
    setLdType(l.discount?.type ?? 'percent');
    setLdValue(l.discount ? String(l.discount.type === 'amount' ? l.discount.value / 100 : l.discount.value) : '');
    setLineSheet(l);
  };

  const applyLineDiscount = () => {
    if (!lineSheet) return;
    const n = parseFloat(ldValue);
    if (!ldValue || Number.isNaN(n) || n <= 0) {
      cart.setLineDiscount(lineSheet.key, null);
      setLineSheet(null);
      return;
    }
    const d: LineDiscount =
      ldType === 'percent'
        ? { type: 'percent', value: Math.min(100, n) }
        : { type: 'amount', value: parseUserAmountToCents(ldValue) ?? 0 };
    if (d.value <= 0) {
      cart.setLineDiscount(lineSheet.key, null);
      setLineSheet(null);
      return;
    }
    if (needApproval) {
      setPendingLine({ key: lineSheet.key, name: lineSheet.name, d });
      setLineSheet(null);
      setGateVisible(true);
      return;
    }
    auditLog('discount_line', `${lineSheet.name} 行折扣 ${auditDiscountText(d)}`, currentStaff?.name ?? '-');
    cart.setLineDiscount(lineSheet.key, d);
    setLineSheet(null);
  };

  const onGateApproved = ({ managerName }: { managerName: string }) => {
    if (pendingDiscount) {
      auditLog('discount_cart', `整单折扣 ${auditDiscountText(pendingDiscount)}`, currentStaff?.name ?? '-', managerName);
      cart.setDiscount(pendingDiscount);
      setPendingDiscount(null);
    }
    if (pendingLine) {
      auditLog('discount_line', `${pendingLine.name} 行折扣 ${auditDiscountText(pendingLine.d)}`, currentStaff?.name ?? '-', managerName);
      cart.setLineDiscount(pendingLine.key, pendingLine.d);
      setPendingLine(null);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <FlatList
        data={cart.lines}
        keyExtractor={(l) => l.key}
        contentContainerStyle={{ padding: 14, paddingBottom: 280 }}
        ListHeaderComponent={
          cart.exchange ? (
            <Card style={{ borderColor: colors.warn, borderWidth: 1 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontWeight: '700' }}>
                    {t('cart.exchange_active', { orderNumber: cart.exchange.orderNumber })}
                  </Text>
                  <Text style={{ color: colors.sub, fontSize: font.xs, marginTop: 2 }}>
                    {t('cart.exchange_summary', {
                      count: cart.exchange.items.reduce((sum, item) => sum + item.qty, 0),
                      amount: formatPosMoney(locale, cart.exchange.creditCents, settings.currency),
                    })}
                  </Text>
                </View>
                <Btn
                  title={t('cart.cancel_exchange')}
                  kind="ghost"
                  size="sm"
                  onPress={() => {
                    if (cart.exchange?.refunded) {
                      Alert.alert(t('cart.cannot_cancel_title'), t('cart.exchange_refund_done'));
                      return;
                    }
                    cart.cancelExchange();
                  }}
                />
              </View>
            </Card>
          ) : null
        }
        ListEmptyComponent={<Empty text={cart.exchange ? t('cart.exchange_empty') : t('cart.empty')} />}
        renderItem={({ item: l }) => {
          const lineOff = lineDiscountCents(l);
          return (
            <Card>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: font.md, fontWeight: '600', color: colors.text }} numberOfLines={2}>
                    {l.name}{l.custom ? t('cart.custom_suffix') : ''}
                  </Text>
                  <Text style={{ fontSize: font.xs, color: colors.sub, marginTop: 2 }}>
                    {[l.variantLabel, l.sku].filter(Boolean).join(' | ') || '-'}
                  </Text>
                  <Text style={{ fontSize: font.sm, color: colors.primary, fontWeight: '700', marginTop: 4 }}>
                    {t('cart.line_price', {
                      unitPrice: formatPosMoney(locale, l.unitPriceCents, settings.currency),
                      count: l.qty,
                      total: formatPosMoney(locale, l.unitPriceCents * l.qty, settings.currency),
                    })}
                  </Text>
                  {lineOff > 0 && l.discount && (
                    <Text style={{ fontSize: font.xs, color: colors.danger, marginTop: 2 }}>
                      {t('cart.line_discount_summary', {
                        discount: discountText(l.discount),
                        amount: formatPosMoney(locale, lineOff, settings.currency),
                        total: formatPosMoney(locale, l.unitPriceCents * l.qty - lineOff, settings.currency),
                      })}
                    </Text>
                  )}
                </View>
                <Stepper value={l.qty} onChange={(q) => cart.setQty(l.key, q)} />
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 18, marginTop: 8 }}>
                <Pressable onPress={() => openLineDiscount(l)} hitSlop={8}>
                  <Text style={{ color: colors.primary, fontSize: font.sm, fontWeight: '600' }}>
                    {l.discount ? t('cart.edit_line_discount') : t('cart.line_discount')}
                  </Text>
                </Pressable>
                <Pressable onPress={() => cart.removeLine(l.key)} hitSlop={8}>
                  <Text style={{ color: colors.danger, fontSize: font.sm }}>{t('cart.remove')}</Text>
                </Pressable>
              </View>
            </Card>
          );
        }}
        ListFooterComponent={
          <View style={{ marginTop: 4 }}>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              <Btn title={cart.discount ? t('cart.cart_discount_active') : t('cart.cart_discount')} kind="outline" size="sm" onPress={() => setDiscountSheet(true)} />
              <Btn title={cart.note ? t('cart.note_active') : t('cart.order_note')} kind="outline" size="sm" onPress={() => { setNoteDraft(cart.note); setNoteSheet(true); }} />
              <Btn title={cart.customer ? t('cart.customer_selected', { name: cart.customer.name }) : t('cart.select_customer')} kind="outline" size="sm" onPress={() => { setCustomerSheet(true); searchCustomers(''); }} />
              {cart.lines.length > 0 && !cart.exchange && <Btn title={t('cart.hold')} kind="outline" size="sm" onPress={() => { setHoldName(''); setHoldSheet(true); }} />}
              {cart.holds.length > 0 && cart.lines.length === 0 && !cart.exchange && <Btn title={t('cart.resume_count', { count: cart.holds.length })} kind="outline" size="sm" onPress={() => setHoldSheet(true)} />}
              {cart.lines.length > 0 && (
                <Btn title={t('cart.clear')} kind="ghost" size="sm" onPress={() => Alert.alert(t('cart.clear_title'), cart.exchange ? t('cart.clear_exchange_body') : '', [{ text: t('cart.cancel') }, { text: t('cart.clear'), style: 'destructive', onPress: () => cart.clear() }])} />
              )}
            </View>
            {cart.holds.length > 0 && cart.lines.length > 0 && (
              <Text style={{ color: colors.sub, fontSize: font.xs, marginTop: 8 }}>
                {t('cart.held_notice', { count: cart.holds.length })}
              </Text>
            )}
          </View>
        }
      />

      {/* 底部合计 */}
      <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: colors.card, borderTopWidth: 1, borderColor: colors.border, padding: 14, paddingBottom: 20 }}>
        <KV k={t('cart.subtotal')} v={formatPosMoney(locale, totals.subtotalCents, settings.currency)} />
        {totals.lineDiscountCents > 0 && <KV k={t('cart.line_discount_total')} v={`−${formatPosMoney(locale, totals.lineDiscountCents, settings.currency)}`} tone="danger" />}
        {totals.cartDiscountCents > 0 && <KV k={cart.discount?.type === 'percent' ? t('cart.cart_discount_percent', { percent: formatPercent(locale, cart.discount.value / 100, { fractionDigits: 0 }) }) : t('cart.cart_discount_total')} v={`−${formatPosMoney(locale, totals.cartDiscountCents, settings.currency)}`} tone="danger" />}
        {totals.promoDiscountCents > 0 && <KV k={t('cart.promotion', { label: totals.promoLabel ?? '' })} v={`−${formatPosMoney(locale, totals.promoDiscountCents, settings.currency)}`} tone="danger" />}
        {totals.taxCents > 0 && <KV k={t('cart.tax', { percent: formatPercent(locale, settings.taxRateBps / 10000, { fractionDigits: 2 }) })} v={formatPosMoney(locale, totals.taxCents, settings.currency)} />}
        <KV k={t('cart.total')} v={formatPosMoney(locale, totals.totalCents, settings.currency)} bold />
        {cart.exchange && (
          <KV k={t('cart.exchange_credit', { orderNumber: cart.exchange.orderNumber })} v={`−${formatPosMoney(locale, Math.min(cart.exchange.creditCents, totals.totalCents), settings.currency)}`} tone="danger" />
        )}
        <Btn
          title={t('cart.checkout')}
          size="lg"
          disabled={cart.lines.length === 0}
          onPress={() => router.push('/checkout')}
          style={{ marginTop: 8 }}
        />
      </View>

      <ManagerPinGate
        visible={gateVisible}
        actionLabel={pendingLine ? t('cart.line_discount_approval_action') : t('cart.discount_approval_action')}
        onClose={() => setGateVisible(false)}
        onApproved={onGateApproved}
      />

      {/* 整单折扣 */}
      <Sheet visible={discountSheet} onClose={() => setDiscountSheet(false)} title={t('cart.discount_title')}>
        <Segment
          options={[{ value: 'percent' as const, label: t('cart.percent_option') }, { value: 'amount' as const, label: t('cart.amount_option', { currency: symbol }) }]}
          value={dType}
          onChange={setDType}
        />
        <Field label={dType === 'percent' ? t('cart.discount_percent_label') : t('cart.discount_amount_label', { currency: symbol })} value={dValue} onChangeText={setDValue} keyboardType="decimal-pad" placeholder={dType === 'percent' ? t('cart.percent_example') : '0.00'} />
        {dType === 'percent' && (
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
            {[5, 10, 20, 50].map((p) => (
              <Btn key={p} title={`${p}%`} kind="outline" size="sm" onPress={() => setDValue(String(p))} />
            ))}
          </View>
        )}
        {settings.promoRules.some((r) => r.enabled) && (
          <Text style={{ color: colors.sub, fontSize: font.xs, marginBottom: 10 }}>
            {t('cart.discount_stacking_note')}
          </Text>
        )}
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Btn title={t('cart.remove_discount')} kind="ghost" onPress={() => { cart.setDiscount(null); setDValue(''); setDiscountSheet(false); }} style={{ flex: 1 }} />
          <Btn title={t('cart.apply')} onPress={applyDiscount} style={{ flex: 1 }} />
        </View>
      </Sheet>

      {/* 行级折扣 */}
      <Sheet visible={!!lineSheet} onClose={() => setLineSheet(null)} title={t('cart.line_discount_title', { name: lineSheet?.name ?? '' })}>
        {lineSheet && (
          <Text style={{ color: colors.sub, fontSize: font.sm, marginBottom: 10 }}>
            {t('cart.line_total', {
              total: formatPosMoney(locale, lineSheet.unitPriceCents * lineSheet.qty, settings.currency),
              unitPrice: formatPosMoney(locale, lineSheet.unitPriceCents, settings.currency),
              count: lineSheet.qty,
            })}
          </Text>
        )}
        <Segment
          options={[{ value: 'percent' as const, label: t('cart.percent_option') }, { value: 'amount' as const, label: t('cart.amount_option', { currency: symbol }) }]}
          value={ldType}
          onChange={setLdType}
        />
        <Field label={ldType === 'percent' ? t('cart.discount_percent_label') : t('cart.line_amount_label', { currency: symbol })} value={ldValue} onChangeText={setLdValue} keyboardType="decimal-pad" placeholder={ldType === 'percent' ? t('cart.percent_example') : '0.00'} />
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Btn title={t('cart.clear_line_discount')} kind="ghost" onPress={() => { if (lineSheet) cart.setLineDiscount(lineSheet.key, null); setLineSheet(null); }} style={{ flex: 1 }} />
          <Btn title={t('cart.apply')} onPress={applyLineDiscount} style={{ flex: 1 }} />
        </View>
      </Sheet>

      {/* 备注 */}
      <Sheet visible={noteSheet} onClose={() => setNoteSheet(false)} title={t('cart.order_note')}>
        <Field label={t('cart.note_content')} value={noteDraft} onChangeText={setNoteDraft} placeholder={t('cart.note_placeholder')} />
        <Btn title={t('cart.save')} onPress={() => { cart.setNote(noteDraft.trim()); setNoteSheet(false); }} />
      </Sheet>

      {/* 客户 */}
      <Sheet visible={customerSheet} onClose={() => setCustomerSheet(false)} title={newCustomer ? t('cart.new_customer') : t('cart.select_customer')}>
        {!newCustomer ? (
          <>
            <Field label={t('cart.customer_search')} value={customerQuery} onChangeText={searchCustomers} placeholder={t('cart.customer_search_placeholder')} />
            <ScrollView style={{ maxHeight: 320 }}>
              {cart.customer && (
                <Btn title={t('cart.unlink_customer', { name: cart.customer.name })} kind="ghost" size="sm" onPress={() => { cart.setCustomer(null); setCustomerSheet(false); }} style={{ marginBottom: 8 }} />
              )}
              {customers.map((c) => (
                <Pressable key={c.id} onPress={() => { cart.setCustomer(c); setCustomerSheet(false); }} style={({ pressed }) => [st.card, { backgroundColor: pressed ? colors.primarySoft : colors.card }]}>
                  <Text style={{ fontWeight: '600', color: colors.text }}>{c.name}</Text>
                  <Text style={{ color: colors.sub, fontSize: font.xs, marginTop: 2 }}>{[c.email, c.phone].filter(Boolean).join(' · ') || '-'}</Text>
                </Pressable>
              ))}
              {customers.length === 0 && <Empty text={t('cart.no_customers')} />}
            </ScrollView>
            <Btn title={t('cart.create_customer')} kind="outline" onPress={() => setNewCustomer(true)} style={{ marginTop: 8 }} />
          </>
        ) : (
          <>
            <Field label={t('cart.customer_name')} value={ncName} onChangeText={setNcName} placeholder={t('cart.customer_name_placeholder')} />
            <Field label={t('cart.email')} value={ncEmail} onChangeText={setNcEmail} keyboardType="email-address" placeholder={t('cart.optional')} />
            <Field label={t('cart.phone')} value={ncPhone} onChangeText={setNcPhone} keyboardType="numeric" placeholder={t('cart.optional')} />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Btn title={t('cart.back')} kind="ghost" onPress={() => setNewCustomer(false)} style={{ flex: 1 }} />
              <Btn
                title={t('cart.create_and_select')}
                style={{ flex: 1 }}
                onPress={async () => {
                  if (!ncName.trim()) { Alert.alert(t('catalog.validation_title'), t('cart.customer_name_required')); return; }
                  try {
                    const c = await getDataSource().createCustomer({ name: ncName.trim(), email: ncEmail.trim() || undefined, phone: ncPhone.trim() || undefined });
                    cart.setCustomer(c);
                    setNewCustomer(false);
                    setCustomerSheet(false);
                    setNcName(''); setNcEmail(''); setNcPhone('');
                  } catch (e) {
                    Alert.alert(t('cart.customer_create_failed_title'), errorMessage(e));
                  }
                }}
              />
            </View>
          </>
        )}
      </Sheet>

      {/* 挂单/取单 */}
      <Sheet visible={holdSheet} onClose={() => setHoldSheet(false)} title={cart.lines.length > 0 ? t('cart.hold') : t('cart.resume')}>
        {cart.lines.length > 0 ? (
          <>
            <Field label={t('cart.hold_note')} value={holdName} onChangeText={setHoldName} placeholder={t('cart.hold_note_placeholder')} />
            <Btn title={t('cart.hold_current')} onPress={() => { cart.holdCurrent(holdName.trim()); setHoldSheet(false); }} />
          </>
        ) : (
          <ScrollView style={{ maxHeight: 380 }}>
            {cart.holds.map((h) => (
              <Card key={h.id}>
                <Text style={{ fontWeight: '600', color: colors.text }}>{h.name}</Text>
                <Text style={{ color: colors.sub, fontSize: font.xs, marginTop: 2 }}>
                  {t('cart.held_meta', {
                    time: formatDateTime(locale, new Date(h.at), { timeZone: 'Africa/Maputo' }),
                    count: h.lines.reduce((sum, line) => sum + line.qty, 0),
                  })}
                  {h.customer ? t('cart.customer_suffix', { name: h.customer.name }) : ''}
                </Text>
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                  <Btn title={t('cart.resume')} size="sm" onPress={() => { cart.resumeHold(h.id); setHoldSheet(false); }} style={{ flex: 1 }} />
                  <Btn title={t('cart.delete')} size="sm" kind="danger" onPress={() => cart.deleteHold(h.id)} style={{ flex: 1 }} />
                </View>
              </Card>
            ))}
            {cart.holds.length === 0 && <Empty text={t('cart.no_holds')} />}
          </ScrollView>
        )}
      </Sheet>
    </View>
  );
}
