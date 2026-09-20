// 设置：数据源与服务器 / 货币税率 / 门店信息 / 店长审批矩阵 / 满减规则 / 支付方式（可自定义）/ 扫码枪

import { useRouter } from 'expo-router';
import React, { useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { getDataSource, getDataSourceByKind, isMissingEndpoint, localizedErrorMessage, StoreLocation } from '@/api';
import { ManagerPinGate } from '@/components/ManagerPinGate';
import { Btn, Card, Field, SectionTitle, Segment, Sheet, st } from '@/components/ui';
import { auditLog } from '@/stores/audit';
import { useAuth } from '@/stores/auth';
import { useSettings } from '@/stores/settings';
import type { ApprovalMatrix } from '@/stores/settings';
import { colors, font } from '@/theme';
import { parseUserAmountToCents } from '@/utils/money';
import type { Currency } from '@/utils/money';
import { useCart } from '@/stores/cart';
import { usePending } from '@/stores/pending';
import { useShift } from '@/stores/shift';
import { canSwitchSource } from '@/services/sourceIdentity';
import { formatMoney, useI18n } from '@/i18n';
import type { TranslationKeyWithoutParams } from '@/i18n';
import { applyRuntimeConfig, describeConfig, isInsecureServerUrl, parseRuntimeConfig } from '@/config/deployment';

const APPROVAL_ITEMS: {
  key: keyof ApprovalMatrix;
  labelKey: TranslationKeyWithoutParams;
  subKey: TranslationKeyWithoutParams;
  auditLabel: string;
}[] = [
  { key: 'discount', labelKey: 'settings.approval.discount', subKey: 'settings.approval.discount_description', auditLabel: '折扣（整单/行级）' },
  { key: 'refund', labelKey: 'settings.approval.refund', subKey: 'settings.approval.refund_description', auditLabel: '退款' },
  { key: 'exchange', labelKey: 'settings.approval.exchange', subKey: 'settings.approval.exchange_description', auditLabel: '换货' },
  { key: 'stockAdjust', labelKey: 'settings.approval.stock', subKey: 'settings.approval.stock_description', auditLabel: '库存调整' },
];

export default function Settings() {
  const { locale, setLocale, t } = useI18n();
  const settings = useSettings();
  const router = useRouter();
  const [taxText, setTaxText] = useState((settings.taxRateBps / 100).toString());
  const [pinging, setPinging] = useState(false);
  // 部署配置导入（粘贴 JSON/键值，一步完成服务器/门店/货币/税率）
  const [importSheetVisible, setImportSheetVisible] = useState(false);
  const [importText, setImportText] = useState('');
  const cartBusinessCount = useCart((state) => state.lines.length + state.holds.length + (state.exchange ? 1 : 0));
  const pendingCount = usePending((state) => state.items.length);
  const businessStateCount = cartBusinessCount + pendingCount;
  const financialStateCount = useShift((state) => (
    state.accountingSource === 'server' && state.open ? 1 : 0
  ) + (state.pendingCashMovement ? 1 : 0) + (state.pendingClose ? 1 : 0));

  // 满减规则表单
  const [promoThreshold, setPromoThreshold] = useState('');
  const [promoOff, setPromoOff] = useState('');
  // 权威库位目录（设置页按 inventory_transfer 用途展示全部可调拨库位）
  const [locations, setLocations] = useState<StoreLocation[] | null>(null);
  const [locMsg, setLocMsg] = useState('');
  const [locBusy, setLocBusy] = useState(false);
  // 自定义支付方式表单
  const [newPayLabel, setNewPayLabel] = useState('');

  // 设置页门禁：店员必须店长授权才能进入（可改服务器地址/关审批 → 高敏感）
  const role = useAuth((s) => s.currentStaff?.role);
  const staffName = useAuth((s) => s.currentStaff?.name);
  const [approved, setApproved] = useState(role !== 'staff');
  const approvedRef = useRef(role !== 'staff');

  if (!approved) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <ManagerPinGate
          visible
          actionLabel={t('settings.enter')}
          onApproved={(approval) => {
            approvedRef.current = true;
            setApproved(true);
            auditLog('settings_enter', '店员进入设置页', staffName ?? '-', approval.managerName);
          }}
          onClose={() => {
            if (!approvedRef.current) router.back();
          }}
        />
      </View>
    );
  }

  const testConnection = async () => {
    setPinging(true);
    try {
      const r = await getDataSourceByKind(settings.dataSource).ping();
      Alert.alert(r.ok ? t('settings.connection_ok') : t('settings.connection_failed'));
    } catch (e) {
      Alert.alert(t('settings.connection_failed'), localizedErrorMessage(e, locale));
    } finally {
      setPinging(false);
    }
  };

  const loadLocations = async () => {
    setLocBusy(true);
    setLocMsg('');
    try {
      const locs = await getDataSource().fetchLocations('inventory_transfer');
      setLocations(locs);
      if (locs.length === 0) setLocMsg(t('settings.locations_empty'));
    } catch (e) {
      setLocations(null);
      setLocMsg(isMissingEndpoint(e)
        ? t('settings.locations_unavailable')
        : localizedErrorMessage(e, locale));
    } finally {
      setLocBusy(false);
    }
  };

  const addPromo = () => {
    const threshold = parseUserAmountToCents(promoThreshold);
    const off = parseUserAmountToCents(promoOff);
    if (threshold === null || off === null || threshold <= 0 || off <= 0) {
      Alert.alert(t('settings.promotions'), t('settings.promotion_invalid'));
      return;
    }
    if (off >= threshold) {
      Alert.alert(t('settings.promotions'), t('settings.promotion_discount_invalid'));
      return;
    }
    settings.addPromoRule(threshold, off);
    setPromoThreshold('');
    setPromoOff('');
  };

  const addPayMethod = () => {
    const label = newPayLabel.trim();
    if (!label) {
      Alert.alert(t('settings.payment_methods'), t('settings.payment_name_required'));
      return;
    }
    if (settings.paymentMethods.some((m) => m.label === label)) {
      Alert.alert(t('settings.payment_methods'), t('settings.payment_name_exists'));
      return;
    }
    settings.addPaymentMethod(label);
    setNewPayLabel('');
  };

  // 审批开关变更留痕：关闭某项审批＝放松管控，属高敏感操作，必须记入操作日志（含操作人）
  const toggleApproval = (key: keyof ApprovalMatrix, label: string, required: boolean) => {
    settings.setApproval(key, required);
    auditLog('settings_change', `审批开关「${label}」→ ${required ? '需店长审批' : '已关闭审批'}`, staffName ?? '-');
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 60 }}>
      <SectionTitle text={t('settings.language')} />
      <Card>
        <Segment
          options={[
            { value: 'zh' as const, label: t('language.zh') },
            { value: 'en' as const, label: t('language.en') },
            { value: 'pt' as const, label: t('language.pt') },
          ]}
          value={locale}
          onChange={(nextLocale) => {
            void setLocale(nextLocale);
          }}
        />
        <Text style={{ color: colors.sub, fontSize: font.xs, marginTop: 8, lineHeight: 18 }}>
          {t('settings.language_description')}
        </Text>
      </Card>

      <SectionTitle text={t('settings.data_source')} />
      <Card>
        <Segment
          options={[
            { value: 'tradingweb' as const, label: t('auth.source_tradingweb') },
            { value: 'mock' as const, label: t('auth.source_demo') },
          ]}
          value={settings.dataSource}
          onChange={(v) => {
            const allowed = canSwitchSource(
              { dataSource: settings.dataSource, serverUrl: settings.serverUrl, storeId: settings.storeId },
              { dataSource: v, serverUrl: settings.serverUrl, storeId: v === 'tradingweb' ? settings.storeId : null },
              businessStateCount,
              financialStateCount,
            );
            if (!allowed) {
              Alert.alert(t('auth.cannot_switch_source_title'), t('auth.cannot_switch_source_body'));
              return;
            }
            settings.set({ dataSource: v });
          }}
        />
        {settings.dataSource === 'tradingweb' && (
          <Field
            label={t('auth.server_url')}
            value={settings.serverUrl}
            onChangeText={(t) => settings.set({ serverUrl: t.trim() })}
            editable={businessStateCount === 0 && financialStateCount === 0}
            placeholder="https://your-tradingweb.com"
            keyboardType="url"
          />
        )}
        <Btn title={t('settings.test_connection')} kind="outline" loading={pinging} onPress={testConnection} />
        <Btn
          title={t('settings.deploy_import')}
          kind="outline"
          style={{ marginTop: 8 }}
          onPress={() => { setImportText(describeConfig(settings)); setImportSheetVisible(true); }}
        />
        <Text style={{ color: colors.sub, fontSize: font.xs, marginTop: 8, lineHeight: 18 }}>
          {businessStateCount > 0 || financialStateCount > 0
            ? t('settings.source_locked')
            : t('settings.source_reauth')}
        </Text>
      </Card>

      {/* 部署配置导入 */}
      <Sheet visible={importSheetVisible} onClose={() => setImportSheetVisible(false)} title={t('settings.deploy_import_title')}>
        <Text style={{ color: colors.sub, fontSize: font.xs, marginBottom: 8, lineHeight: 18 }}>
          {t('settings.deploy_import_hint')}
        </Text>
        <TextInput
          style={[st.input, { minHeight: 110, textAlignVertical: 'top' }]}
          value={importText}
          onChangeText={setImportText}
          multiline
          placeholder={t('settings.deploy_import_placeholder')}
          placeholderTextColor="#9CA3AF"
          autoCapitalize="none"
          autoCorrect={false}
        />
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
          <Btn title={t('common.cancel')} kind="ghost" onPress={() => setImportSheetVisible(false)} style={{ flex: 1 }} />
          <Btn
            title={t('settings.deploy_apply')}
            style={{ flex: 1 }}
            onPress={() => {
              const cfg = parseRuntimeConfig(importText);
              if (!cfg) {
                Alert.alert(t('settings.deploy_parse_failed_title'), t('settings.deploy_parse_failed_body'));
                return;
              }
              const next = {
                dataSource: cfg.dataSource ?? settings.dataSource,
                serverUrl: cfg.serverUrl ?? settings.serverUrl,
                storeId: cfg.storeId !== undefined ? cfg.storeId : settings.storeId,
              };
              const allowed = canSwitchSource(
                { dataSource: settings.dataSource, serverUrl: settings.serverUrl, storeId: settings.storeId },
                next,
                businessStateCount,
                financialStateCount,
              );
              if (!allowed) {
                Alert.alert(t('auth.cannot_switch_source_title'), t('auth.cannot_switch_source_body'));
                return;
              }
              applyRuntimeConfig(settings, cfg);
              setImportSheetVisible(false);
              setTaxText(((cfg.taxRateBps ?? settings.taxRateBps) / 100).toString());
              const appliedServerUrl = cfg.serverUrl ?? settings.serverUrl;
              Alert.alert(
                t('settings.deploy_applied'),
                describeConfig({
                  ...next,
                  currency: cfg.currency ?? settings.currency,
                  taxRateBps: cfg.taxRateBps ?? settings.taxRateBps,
                }) + (isInsecureServerUrl(appliedServerUrl) ? `\n\n${t('settings.deploy_http_warning')}` : ''),
              );
            }}
          />
        </View>
      </Sheet>

      <SectionTitle text={t('settings.locations')} />
      <Card>
        <Btn title={locations ? t('settings.refresh_locations') : t('settings.load_locations')} kind="outline" loading={locBusy} onPress={loadLocations} />
        {locations && locations.length > 0 && (
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            {locations.map((l) => {
              const active = settings.currentLocationId === l.id;
              return (
                <Pressable
                  key={l.id}
                  onPress={() => settings.set({ currentLocationId: active ? null : l.id })}
                  style={{
                    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999,
                    backgroundColor: active ? colors.primary : colors.primarySoft,
                  }}
                >
                  <Text style={{ color: active ? '#fff' : colors.primary, fontWeight: '600' }}>{l.name}</Text>
                </Pressable>
              );
            })}
          </View>
        )}
        <Text style={{ color: colors.sub, fontSize: font.xs, marginTop: 8, lineHeight: 18 }}>
          {locMsg || t('settings.locations_help')}
        </Text>
      </Card>

      <SectionTitle text={t('settings.currency_tax')} />
      <Card>
        <Segment
          options={[
            { value: 'USD' as Currency, label: '$ USD' },
            { value: 'CNY' as Currency, label: '¥ CNY' },
            { value: 'EUR' as Currency, label: '€ EUR' },
            { value: 'MZN' as Currency, label: t('settings.currency_mzn_label') },
          ]}
          value={settings.currency}
          onChange={(v) => settings.set({ currency: v })}
        />
        <Field
          label={t('settings.tax_rate')}
          value={taxText}
          onChangeText={(t) => {
            setTaxText(t);
            const n = parseFloat(t);
            if (!Number.isNaN(n) && n >= 0 && n <= 50) settings.set({ taxRateBps: Math.round(n * 100) });
          }}
          keyboardType="decimal-pad"
          placeholder={t('settings.tax_placeholder')}
        />
      </Card>

      <SectionTitle text={t('settings.store_info')} />
      <Card>
        <Field label={t('settings.store_name')} value={settings.store.name} onChangeText={(value) => settings.setStore({ name: value })} />
        <Field label={t('settings.store_address')} value={settings.store.address} onChangeText={(value) => settings.setStore({ address: value })} placeholder={t('settings.store_address_placeholder')} />
        <Field label={t('settings.receipt_footer')} value={settings.store.footer} onChangeText={(value) => settings.setStore({ footer: value })} placeholder={t('settings.receipt_footer_placeholder')} />
      </Card>

      <SectionTitle text={t('settings.approvals')} />
      <Card>
        {APPROVAL_ITEMS.map((it, i) => (
          <View
            key={it.key}
            style={{
              flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
              marginBottom: i === APPROVAL_ITEMS.length - 1 ? 0 : 12,
            }}
          >
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={{ fontSize: font.md, fontWeight: '600', color: colors.text }}>{t(it.labelKey)}</Text>
              <Text style={{ fontSize: font.xs, color: colors.sub, marginTop: 2 }}>{t(it.subKey)}</Text>
            </View>
            <Switch value={settings.approvals[it.key]} onValueChange={(v) => toggleApproval(it.key, it.auditLabel, v)} />
          </View>
        ))}
        <Text style={{ color: colors.sub, fontSize: font.xs, marginTop: 10, lineHeight: 18 }}>
          {t('settings.approvals_help')}
        </Text>
      </Card>

      <SectionTitle text={t('settings.promotions')} />
      <Card>
        {settings.promoRules.length === 0 && (
          <Text style={{ color: colors.sub, fontSize: font.sm, marginBottom: 10 }}>
            {t('settings.promotions_empty')}
          </Text>
        )}
        {settings.promoRules.map((r) => (
          <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: font.md, fontWeight: '600', color: colors.text }}>{r.label}</Text>
              <Text style={{ fontSize: font.xs, color: colors.sub, marginTop: 2 }}>
                {t('settings.promotion_summary', {
                  threshold: formatMoney(locale, r.thresholdCents / 100, settings.currency),
                  discount: formatMoney(locale, r.discountCents / 100, settings.currency),
                })}
              </Text>
            </View>
            <Switch value={r.enabled} onValueChange={(v) => settings.setPromoRuleEnabled(r.id, v)} />
            <Pressable onPress={() => settings.removePromoRule(r.id)} hitSlop={8}>
              <Text style={{ color: colors.danger, fontSize: font.sm }}>{t('common.delete')}</Text>
            </Pressable>
          </View>
        ))}
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Field label={t('settings.promotion_threshold', { currency: settings.currency })} value={promoThreshold} onChangeText={setPromoThreshold} keyboardType="decimal-pad" placeholder="200" />
          </View>
          <View style={{ flex: 1 }}>
            <Field label={t('settings.promotion_discount', { currency: settings.currency })} value={promoOff} onChangeText={setPromoOff} keyboardType="decimal-pad" placeholder="20" />
          </View>
        </View>
        <Btn title={t('settings.add_promotion')} kind="outline" onPress={addPromo} />
      </Card>

      <SectionTitle text={t('settings.checkout')} />
      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={{ fontSize: font.md, fontWeight: '600', color: colors.text }}>{t('settings.auto_print')}</Text>
            <Text style={{ fontSize: font.xs, color: colors.sub, marginTop: 2 }}>{t('settings.auto_print_description')}</Text>
          </View>
          <Switch value={settings.autoPrintReceipt} onValueChange={(v) => settings.set({ autoPrintReceipt: v })} />
        </View>
      </Card>

      <SectionTitle text={t('settings.payment_methods')} />
      <Card>
        {settings.paymentMethods.map((m) => (
          <View
            key={m.method}
            style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}
          >
            <Text style={{ fontSize: font.md, color: colors.text }}>
              {m.label}
              {m.custom ? <Text style={{ color: colors.sub, fontSize: font.xs }}>{t('settings.custom')}</Text> : null}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              {m.custom && (
                <Pressable
                  onPress={() =>
                    Alert.alert(t('settings.delete_payment_title'), t('settings.delete_payment_body', { label: m.label }), [
                      { text: t('common.cancel') },
                      { text: t('common.delete'), style: 'destructive', onPress: () => settings.removePaymentMethod(m.method) },
                    ])
                  }
                  hitSlop={8}
                >
                  <Text style={{ color: colors.danger, fontSize: font.sm }}>{t('common.delete')}</Text>
                </Pressable>
              )}
              <Switch value={m.enabled} onValueChange={(v) => settings.setPaymentMethodEnabled(m.method, v)} />
            </View>
          </View>
        ))}
        <Field label={t('settings.new_payment')} value={newPayLabel} onChangeText={setNewPayLabel} placeholder={t('settings.new_payment_placeholder')} />
        <Btn title={t('settings.add_payment')} kind="outline" onPress={addPayMethod} />
        <Text style={{ color: colors.sub, fontSize: font.xs, marginTop: 8, lineHeight: 18 }}>
          {t('settings.payment_help')}
        </Text>
      </Card>

      <SectionTitle text={t('settings.scanner')} />
      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={{ fontSize: font.md, fontWeight: '600', color: colors.text }}>{t('settings.hid_scanner')}</Text>
            <Text style={{ fontSize: font.xs, color: colors.sub, marginTop: 2 }}>
              {t('settings.hid_scanner_description')}
            </Text>
          </View>
          <Switch value={settings.hidScannerEnabled} onValueChange={(v) => settings.set({ hidScannerEnabled: v })} />
        </View>
      </Card>
    </ScrollView>
  );
}
