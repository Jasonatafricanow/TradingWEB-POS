// 商品详情：变体/库存一览 + Task 11 服务端库存调整。

import { useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { errorMessage, getDataSource, LocationStock, Product, ProductVariant, StoreLocation, variantLabel } from '@/api';
import type { EntityId, StockAdjustInput } from '@/api';
import { Btn, Card, Field, KV, SectionTitle, Segment, Sheet } from '@/components/ui';
import { ManagerPinGate } from '@/components/ManagerPinGate';
import { auditLog } from '@/stores/audit';
import { useAuth } from '@/stores/auth';
import { useSettings } from '@/stores/settings';
import { colors, font } from '@/theme';
import { CURRENCY_SYMBOL, formatCents } from '@/utils/money';
import { buildPosInventoryAdjustmentRequest } from '@/services/posInventoryRequests';
import {
  completeInventoryOperation,
  InventoryOperationIdentity,
  reserveInventoryOperation,
} from '@/services/inventoryOperationIdentity';
import {
  activeDefaultLocations,
  canUsePosPermission,
  inventoryOperationScope,
} from '@/services/inventoryUiPolicy';

const REASONS = [
  { label: '盘点', value: 'count' as const },
  { label: '收货', value: 'receive' as const },
  { label: '报损', value: 'damage' as const },
  { label: '纠错', value: 'correction' as const },
];

export default function ProductDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const settings = useSettings();
  const symbol = CURRENCY_SYMBOL[settings.currency];
  const [product, setProduct] = useState<Product | null>(null);
  const [notFound, setNotFound] = useState(false);

  const [adjustSheet, setAdjustSheet] = useState(false);
  const [targetVariant, setTargetVariant] = useState<ProductVariant | null>(null);
  const [direction, setDirection] = useState<'in' | 'out'>('in');
  const [qtyText, setQtyText] = useState('1');
  const [reason, setReason] = useState<StockAdjustInput['reason']>(REASONS[0].value);
  const [note, setNote] = useState('');
  const [adjustmentIdentity, setAdjustmentIdentity] = useState<InventoryOperationIdentity | null>(null);
  const [pendingAdjustment, setPendingAdjustment] = useState<StockAdjustInput | null>(null);
  const [busy, setBusy] = useState(false);
  // TradingWEB 调整仅使用服务器返回的 active store-default 库位。
  const [locations, setLocations] = useState<StoreLocation[] | null>(null);
  const [locStocks, setLocStocks] = useState<LocationStock[] | null>(null);
  const [adjLocationId, setAdjLocationId] = useState<EntityId | null>(null);
  const currentStaff = useAuth((s) => s.currentStaff);
  const canAdjust = canUsePosPermission(settings.dataSource, currentStaff, 'inventory_adjust');
  const [gateVisible, setGateVisible] = useState(false);

  const load = useCallback(async () => {
    try {
      const all = await getDataSource().fetchProducts('');
      const p = all.find((x) => String(x.id) === String(id));
      if (!p) setNotFound(true);
      setProduct(p ?? null);
    } catch (e) {
      Alert.alert('加载失败', errorMessage(e));
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (notFound) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <Text style={{ color: colors.sub }}>商品不存在或已下架</Text>
      </View>
    );
  }
  if (!product) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  const openAdjust = (v: ProductVariant | null) => {
    setTargetVariant(v);
    setDirection('in');
    setQtyText('1');
    setReason(REASONS[0].value);
    setNote('');
    setAdjustmentIdentity(null);
    setPendingAdjustment(null);
    setLocStocks(null);
    setAdjustSheet(true);
    (async () => {
      try {
        const fetchedLocations = await getDataSource().fetchLocations('inventory_adjustment');
        const locs = settings.dataSource === 'tradingweb'
          ? activeDefaultLocations(fetchedLocations)
          : fetchedLocations.filter((location) => location.isActive !== false);
        setLocations(locs);
        const configuredLocation = locs.find((location) => location.id === settings.currentLocationId)?.id;
        setAdjLocationId(configuredLocation ?? locs[0]?.id ?? null);
        if (product) {
          const stocks = await getDataSource().fetchStockByLocation(product.id, v?.id ?? null);
          setLocStocks(stocks);
        }
      } catch {
        setLocations([]);
        setAdjLocationId(null);
      }
    })();
  };

  const requestAdjust = async () => {
    if (!canAdjust) {
      Alert.alert('无权限', '当前操作员无库存调整权限');
      return;
    }
    const qty = parseInt(qtyText, 10);
    if (Number.isNaN(qty) || qty <= 0) {
      Alert.alert('提示', '请输入有效数量');
      return;
    }
    if (settings.dataSource === 'tradingweb' && !adjLocationId) {
      Alert.alert('提示', '请选择库存库位');
      return;
    }
    const payload = {
      productId: product.id,
      variantId: targetVariant?.id ?? null,
      delta: direction === 'in' ? qty : -qty,
      reason,
      note: note.trim() || null,
      locationId: adjLocationId,
    };
    const dataSource = getDataSource();
    const scope = inventoryOperationScope(dataSource.kind, dataSource.getSourceScope(), currentStaff?.id);
    if (!scope) {
      Alert.alert('操作受限', '无法确认当前服务器、门店、操作员与设备身份');
      return;
    }
    const identity = await reserveInventoryOperation('adjustment', scope, payload);
    const draft: StockAdjustInput = {
      clientRef: identity.clientRef,
      ...payload,
      approvalToken: null,
    };
    setAdjustmentIdentity(identity);
    setPendingAdjustment(draft);
    if (settings.dataSource === 'tradingweb') {
      setGateVisible(true);
      return;
    }
    // 库存增减是盗窃掩盖常见通道：店员操作需店长授权。
    if (settings.approvals.stockAdjust && currentStaff?.role === 'staff') {
      setGateVisible(true);
      return;
    }
    doAdjust(undefined, draft, identity);
  };

  const doAdjust = async (
    approval?: { managerName: string; token: string | null },
    requestedAdjustment: StockAdjustInput | null = pendingAdjustment,
    requestedIdentity: InventoryOperationIdentity | null = adjustmentIdentity,
  ) => {
    if (!requestedAdjustment) return;
    setBusy(true);
    try {
      await getDataSource().adjustStock({
        ...requestedAdjustment,
        approvalToken: approval?.token ?? null,
      });
      if (requestedIdentity) await completeInventoryOperation(requestedIdentity);
      const locName = locations?.find((l) => l.id === adjLocationId)?.name;
      const reasonLabel = REASONS.find((item) => item.value === requestedAdjustment.reason)?.label ?? requestedAdjustment.reason;
      auditLog(
        'stock_adjust',
        `${product.name}${targetVariant ? `（${variantLabel(targetVariant) || '默认'}）` : ''} ${requestedAdjustment.delta > 0 ? '+' : ''}${requestedAdjustment.delta}（${reasonLabel}${locName ? ` · ${locName}` : ''}）`,
        currentStaff?.name ?? '-',
        approval?.managerName
      );
      setAdjustSheet(false);
      setPendingAdjustment(null);
      setAdjustmentIdentity(null);
      await load();
    } catch (e) {
      Alert.alert('库存调整失败', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 60 }}>
      <Card>
        <Text style={{ fontSize: font.lg, fontWeight: '800', color: colors.text }}>{product.name}</Text>
        <View style={{ marginTop: 8 }}>
          <KV k="类型" v={product.type === 'physical' ? '实物' : product.type === 'service' ? '服务' : '虚拟'} />
          <KV k="展示价" v={product.priceCents !== null ? formatCents(product.priceCents, symbol) : '按变体定价'} />
          {product.sku ? <KV k="SKU" v={product.sku} /> : null}
          {product.barcode ? <KV k="条码" v={product.barcode} /> : null}
          {!product.hasVariants && product.stock !== null && <KV k="库存" v={String(product.stock)} bold />}
        </View>
        {!product.hasVariants && canAdjust && (
          <Btn testID="adjust-inventory" title="调整库存" kind="outline" onPress={() => openAdjust(null)} style={{ marginTop: 10 }} />
        )}
      </Card>

      {product.hasVariants && canAdjust && (
        <>
          <SectionTitle text={`变体（${product.variants.length}）· 点击调整库存`} />
          {product.variants.map((v) => (
            <Pressable key={v.id} onPress={() => openAdjust(v)}>
              <Card style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: '600', color: colors.text }}>{variantLabel(v) || '默认'}</Text>
                  <Text style={{ color: colors.sub, fontSize: font.xs, marginTop: 2 }}>
                    {v.sku ?? '-'}{v.barcode && v.barcode !== v.sku ? ` · ${v.barcode}` : ''}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ fontWeight: '700', color: colors.primary }}>
                    {v.priceCents !== null ? formatCents(v.priceCents, symbol) : '未定价'}
                  </Text>
                  <Text style={{ color: v.stock !== null && v.stock <= 0 ? colors.danger : colors.sub, fontSize: font.sm, marginTop: 2 }}>
                    库存 {v.stock ?? '-'}
                  </Text>
                </View>
              </Card>
            </Pressable>
          ))}
        </>
      )}

      <Sheet visible={adjustSheet} onClose={() => setAdjustSheet(false)} title={`库存调整${targetVariant ? ` · ${variantLabel(targetVariant) || '默认'}` : ''}`}>
        <Segment
          options={[{ value: 'in' as const, label: '入库 +' }, { value: 'out' as const, label: '出库 −' }]}
          value={direction}
          onChange={setDirection}
        />
        {locStocks && locStocks.length > 0 && (
          <View style={{ marginBottom: 10 }}>
            {locStocks.map((s) => (
              <KV key={s.locationId} k={s.locationName} v={`库存 ${s.stock}`} />
            ))}
          </View>
        )}
        {locations && locations.length > 0 && (
          <>
            <Text style={{ color: colors.sub, fontSize: font.sm, marginBottom: 6 }}>调整库位</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
              {locations.map((l) => (
                <Pressable
                  key={l.id}
                  testID={`adj-location-${l.id}`}
                  onPress={() => setAdjLocationId(l.id)}
                  style={{
                    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999,
                    backgroundColor: adjLocationId === l.id ? colors.primary : colors.primarySoft,
                  }}
                >
                  <Text style={{ color: adjLocationId === l.id ? '#fff' : colors.primary, fontWeight: '600' }}>{l.name}</Text>
                </Pressable>
              ))}
            </View>
          </>
        )}
        <Field label="数量" value={qtyText} onChangeText={setQtyText} keyboardType="number-pad" />
        <Text style={{ color: colors.sub, fontSize: font.sm, marginBottom: 6 }}>原因</Text>
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          {REASONS.map((r) => (
            <Pressable
              key={r.value}
              onPress={() => setReason(r.value)}
              style={{
                paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999,
                backgroundColor: reason === r.value ? colors.primary : colors.primarySoft,
              }}
            >
              <Text style={{ color: reason === r.value ? '#fff' : colors.primary, fontWeight: '600' }}>{r.label}</Text>
            </Pressable>
          ))}
        </View>
        <Field label="备注（可选）" value={note} onChangeText={setNote} />
        <Btn testID="submit-adjustment" title="确认调整" loading={busy} onPress={() => void requestAdjust()} />
      </Sheet>

      <ManagerPinGate
        visible={gateVisible}
        actionLabel="库存调整"
        approvalMode={settings.dataSource === 'tradingweb' ? 'server' : 'local'}
        operation="inventory_adjustment"
        resourceHash={
          pendingAdjustment && settings.storeId
            ? buildPosInventoryAdjustmentRequest(pendingAdjustment, settings.storeId).resourceHash
            : undefined
        }
        onClose={() => setGateVisible(false)}
        onApproved={(approval) => doAdjust(approval)}
      />
    </ScrollView>
  );
}
