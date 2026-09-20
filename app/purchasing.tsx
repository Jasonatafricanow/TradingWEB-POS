// 采购与补货：销速补货建议 / 采购单（新建 → 收货入库）
// TradingWEB 使用 /api/admin/pos/* 权威库存、调拨和采购端点；Mock 行为保持原样。
// 演示模式完整可用：内存采购单，收货自动入库（默认库位或后仓）。

import { useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Alert, RefreshControl, ScrollView, Text, View } from 'react-native';
import {
  CreatePurchaseOrderInput, errorMessage, getDataSource, isMissingEndpoint,
  InventoryTransferInput, Product, PurchaseOrder, StoreLocation,
} from '@/api';
import { Btn, Card, Empty, Field, KV, SectionTitle, Sheet, st, Stepper, Tag } from '@/components/ui';
import { ManagerPinGate } from '@/components/ManagerPinGate';
import { auditLog } from '@/stores/audit';
import { useAuth } from '@/stores/auth';
import { useSettings } from '@/stores/settings';
import { colors, font } from '@/theme';
import { computeRestockSuggestions, RestockSuggestion } from '@/utils/restock';
import { parseUserAmountToCents } from '@/utils/money';
import { completeInventoryOperation, reserveInventoryOperation } from '@/services/inventoryOperationIdentity';
import { activeDefaultLocations, canUsePosPermission, inventoryOperationScope } from '@/services/inventoryUiPolicy';
import { buildPosPurchaseOrderIdentityFacts } from '@/services/posInventoryRequests';
import { hashPosApprovalRequest } from '@/services/posRequests';

export default function Purchasing() {
  const settings = useSettings();
  const staff = useAuth((s) => s.currentStaff);
  const [suggestions, setSuggestions] = useState<RestockSuggestion[] | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [purchaseLocations, setPurchaseLocations] = useState<StoreLocation[] | null>(null);
  const [transferLocations, setTransferLocations] = useState<StoreLocation[] | null>(null);
  const [pos, setPos] = useState<PurchaseOrder[] | null>(null);
  const [poMsg, setPoMsg] = useState('');
  const [loading, setLoading] = useState(false);

  // 新建采购单
  const [createSheet, setCreateSheet] = useState(false);
  const [supplier, setSupplier] = useState('');
  const [pickQty, setPickQty] = useState<Record<string, number>>({});
  const [unitCosts, setUnitCosts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  // 库位调拨（POS 只创建 pending，审批/完成留在 TradingWEB 管理端）
  const [transferSheet, setTransferSheet] = useState(false);
  const [transferFrom, setTransferFrom] = useState<string | null>(null);
  const [transferTo, setTransferTo] = useState<string | null>(null);
  const [transferNote, setTransferNote] = useState('');
  const [transferQty, setTransferQty] = useState<Record<string, number>>({});

  // 收货审批（库存变动，沿用 stockAdjust 审批开关）
  const [gatePo, setGatePo] = useState<PurchaseOrder | null>(null);

  const canReadPurchaseOrders = canUsePosPermission(settings.dataSource, staff, 'purchase_order_read');
  const canCreatePurchaseOrder = canUsePosPermission(settings.dataSource, staff, 'purchase_order_create');
  const canReceivePurchaseOrder = canUsePosPermission(settings.dataSource, staff, 'purchase_order_receive');
  const canTransferInventory = canUsePosPermission(settings.dataSource, staff, 'inventory_transfer');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const ds = getDataSource();
      const [prods, orders] = await Promise.all([ds.fetchProducts(''), ds.fetchOrders()]);
      setProducts(prods);
      setSuggestions(computeRestockSuggestions(prods, orders));
      if (canCreatePurchaseOrder) {
        try {
          setPurchaseLocations(await ds.fetchLocations('purchase_order'));
        } catch {
          setPurchaseLocations(null);
        }
      } else {
        setPurchaseLocations(null);
      }
      if (canTransferInventory) {
        try {
          setTransferLocations(await ds.fetchLocations('inventory_transfer'));
        } catch {
          setTransferLocations(null);
        }
      } else {
        setTransferLocations(null);
      }
      try {
        if (!canReadPurchaseOrders) {
          setPos(null);
          setPoMsg('当前操作员无采购单查看权限');
        } else {
          setPos(await ds.fetchPurchaseOrders());
          setPoMsg('');
        }
      } catch (e) {
        setPos(null);
        setPoMsg(isMissingEndpoint(e) ? 'TradingWEB POS 采购端点不可用' : errorMessage(e));
      }
    } catch (e) {
      Alert.alert('加载失败', errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [canCreatePurchaseOrder, canReadPurchaseOrders, canTransferInventory]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const pickedCount = Object.values(pickQty).reduce((s, n) => s + n, 0);

  const poLocations = settings.dataSource === 'tradingweb'
    ? activeDefaultLocations(purchaseLocations ?? [])
    : (purchaseLocations ?? []).filter((location) => location.isActive !== false);
  const selectedPoLocation = poLocations.find((location) => location.id === settings.currentLocationId)?.id
    ?? poLocations[0]?.id
    ?? null;

  const createPo = async () => {
    if (!canCreatePurchaseOrder) {
      Alert.alert('无权限', '当前操作员无新建采购单权限');
      return;
    }
    if (!supplier.trim()) {
      Alert.alert('提示', '请填写供应商');
      return;
    }
    if (pickedCount <= 0) {
      Alert.alert('提示', '请选择采购商品数量');
      return;
    }
    if (!selectedPoLocation) {
      Alert.alert('提示', '请先选择入库库位');
      return;
    }
    const items: CreatePurchaseOrderInput['items'] = [];
    for (const p of products) {
      if (p.hasVariants) {
        for (const v of p.variants) {
          const q = pickQty[`v${v.id}`] ?? 0;
          if (q > 0) {
            const key = `v${v.id}`;
            const unitCostCents = parseUserAmountToCents(unitCosts[key] ?? '');
            if (unitCostCents === null) {
              Alert.alert('提示', `请显式填写 ${p.name} 的单位成本`);
              return;
            }
            items.push({
              productId: p.id, variantId: v.id, name: p.name,
              variantLabel: [v.option1, v.option2, v.option3].filter(Boolean).join(' / ') || null,
              sku: v.sku, qty: q, unitCostCents,
            });
          }
        }
      } else {
        const q = pickQty[`p${p.id}`] ?? 0;
        if (q > 0) {
          const key = `p${p.id}`;
          const unitCostCents = parseUserAmountToCents(unitCosts[key] ?? '');
          if (unitCostCents === null) {
            Alert.alert('提示', `请显式填写 ${p.name} 的单位成本`);
            return;
          }
          items.push({
            productId: p.id, variantId: null, name: p.name, variantLabel: null,
            sku: p.sku, qty: q, unitCostCents,
          });
        }
      }
    }
    const payload = { supplier: supplier.trim(), locationId: selectedPoLocation, items };
    const dataSource = getDataSource();
    const scope = inventoryOperationScope(dataSource.kind, dataSource.getSourceScope(), staff?.id);
    if (!scope) {
      Alert.alert('操作受限', '无法确认当前服务器、门店、操作员与设备身份');
      return;
    }
    const identity = await reserveInventoryOperation(
      'purchase-order',
      scope,
      buildPosPurchaseOrderIdentityFacts(payload, scope.storeId),
    );
    setBusy(true);
    try {
      const po = await dataSource.createPurchaseOrder({ clientRef: identity.clientRef, ...payload });
      await completeInventoryOperation(identity);
      auditLog('po_create', `新建采购单 ${po.number}（${supplier.trim()}，${pickedCount} 件）`, staff?.name ?? '-');
      setCreateSheet(false);
      setSupplier('');
      setPickQty({});
      setUnitCosts({});
      await load();
    } catch (e) {
      Alert.alert('创建失败', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const requestReceive = (po: PurchaseOrder) => {
    if (!canReceivePurchaseOrder) return;
    const needsApproval = settings.dataSource === 'tradingweb'
      || (settings.approvals.stockAdjust && staff?.role === 'staff');
    if (needsApproval) {
      setGatePo(po);
      return;
    }
    doReceive(po);
  };

  const openTransfer = () => {
    if (!canTransferInventory) return;
    const activeLocations = (transferLocations ?? []).filter((location) => location.isActive !== false);
    setTransferFrom(activeLocations[0]?.id ?? null);
    setTransferTo(activeLocations[1]?.id ?? null);
    setTransferNote('');
    setTransferQty({});
    setTransferSheet(true);
  };

  const createTransfer = async () => {
    if (!canTransferInventory) {
      Alert.alert('无权限', '当前操作员无库存调拨权限');
      return;
    }
    if (!transferFrom || !transferTo || transferFrom === transferTo) {
      Alert.alert('提示', '请选择两个不同库位');
      return;
    }
    const items: InventoryTransferInput['items'] = [];
    for (const product of products) {
      if (product.hasVariants) {
        for (const variant of product.variants) {
          const quantity = transferQty[`v${variant.id}`] ?? 0;
          if (quantity > 0) items.push({ productId: product.id, variantId: variant.id, quantity });
        }
      } else {
        const quantity = transferQty[`p${product.id}`] ?? 0;
        if (quantity > 0) items.push({ productId: product.id, variantId: null, quantity });
      }
    }
    if (items.length === 0) {
      Alert.alert('提示', '请选择调拨商品数量');
      return;
    }
    const payload = {
      fromLocationId: transferFrom,
      toLocationId: transferTo,
      note: transferNote.trim() || null,
      items,
    };
    const dataSource = getDataSource();
    const scope = inventoryOperationScope(dataSource.kind, dataSource.getSourceScope(), staff?.id);
    if (!scope) {
      Alert.alert('操作受限', '无法确认当前服务器、门店、操作员与设备身份');
      return;
    }
    const identity = await reserveInventoryOperation('transfer', scope, payload);
    setBusy(true);
    try {
      const transfer = await dataSource.createInventoryTransfer({ clientRef: identity.clientRef, ...payload });
      await completeInventoryOperation(identity);
      auditLog('stock_adjust', `创建库存调拨 ${transfer.referenceNo}（待 TradingWEB 审批）`, staff?.name ?? '-');
      Alert.alert('调拨已创建', `${transfer.referenceNo} 已进入待审批状态`);
      setTransferSheet(false);
    } catch (error) {
      Alert.alert('创建调拨失败', errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const doReceive = async (po: PurchaseOrder, approvedBy?: string, approvalToken?: string | null) => {
    try {
      await getDataSource().receivePurchaseOrder(po.id, approvalToken ?? null);
      auditLog('po_receive', `采购单 ${po.number} 收货入库（${po.items.reduce((s, i) => s + i.qty, 0)} 件）`, staff?.name ?? '-', approvedBy);
      await load();
    } catch (e) {
      Alert.alert('收货失败', errorMessage(e));
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 60 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
      >
        <SectionTitle text="补货建议（按最近订单销速估算）" />
        <Card>
          {suggestions === null && <Text style={{ color: colors.sub }}>计算中…</Text>}
          {suggestions !== null && suggestions.length === 0 && (
            <Text style={{ color: colors.sub }}>暂无需要补货的商品（可售天数均 ≥ 7 天或无销售记录）</Text>
          )}
          {(suggestions ?? []).map((sg) => (
            <View key={sg.key} style={{ paddingVertical: 6, borderBottomWidth: 1, borderColor: colors.border }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: colors.text, fontWeight: '600', flex: 1 }} numberOfLines={1}>
                  {sg.name}{sg.variantLabel ? `（${sg.variantLabel}）` : ''}
                </Text>
                <Tag text={sg.stock <= 0 ? '缺货' : `约剩 ${sg.daysLeft} 天`} tone={sg.stock <= 0 ? 'danger' : 'warn'} />
              </View>
              <Text style={{ color: colors.sub, fontSize: font.xs, marginTop: 2 }}>
                库存 {sg.stock} · 近端销速 {sg.dailyRate}/天 · 建议补 {sg.suggestQty} 件
              </Text>
            </View>
          ))}
          <Text style={{ color: colors.sub, fontSize: font.xs, marginTop: 8 }}>
            估算口径：最近拉取的订单（≤50 单、≤14 天窗口），补到可售 14 天。仅供参考。
          </Text>
        </Card>

        <SectionTitle text="采购单" />
        <View style={{ gap: 8, marginBottom: 10 }}>
          {canCreatePurchaseOrder && (
            <Btn testID="new-purchase-order" title="＋ 新建采购单" kind="outline" onPress={() => {
              setSupplier(''); setPickQty({}); setUnitCosts({}); setCreateSheet(true);
            }} />
          )}
          {canTransferInventory
            && (transferLocations?.filter((location) => location.isActive !== false).length ?? 0) >= 2 && (
              <Btn testID="new-inventory-transfer" title="创建库位调拨" kind="outline" onPress={openTransfer} />
            )}
        </View>
        {pos === null ? (
          <Card>
            <Text style={{ color: colors.warn, fontSize: font.sm, lineHeight: 20 }}>{poMsg || '加载中…'}</Text>
          </Card>
        ) : (
          <>
            {pos.length === 0 && <Empty text="暂无采购单" />}
            {pos.map((po) => (
              <Card key={po.id}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ fontWeight: '700', color: colors.text }}>{po.number} · {po.supplier}</Text>
                  <Tag text={po.status === 'received' ? '已收货' : '待收货'} tone={po.status === 'received' ? 'success' : 'warn'} />
                </View>
                <Text style={{ color: colors.sub, fontSize: font.xs, marginTop: 4 }}>
                  {new Date(po.createdAt).toLocaleString()} · {po.items.reduce((s, i) => s + i.qty, 0)} 件
                  {po.receivedAt ? ` · 收货于 ${new Date(po.receivedAt).toLocaleString()}` : ''}
                </Text>
                {po.items.slice(0, 3).map((it, i) => (
                  <Text key={i} style={{ color: colors.sub, fontSize: font.xs, marginTop: 2 }} numberOfLines={1}>
                    · {it.name}{it.variantLabel ? `（${it.variantLabel}）` : ''} × {it.qty}
                  </Text>
                ))}
                {po.items.length > 3 && <Text style={{ color: colors.sub, fontSize: font.xs }}>…共 {po.items.length} 行</Text>}
                {po.status === 'ordered' && canReceivePurchaseOrder && (
                  <Btn title="收货入库" size="sm" kind="success" style={{ marginTop: 8 }} onPress={() => requestReceive(po)} />
                )}
              </Card>
            ))}
          </>
        )}
      </ScrollView>

      {/* 新建采购单 */}
      <Sheet visible={createSheet} onClose={() => setCreateSheet(false)} title="新建采购单">
        <Field label="供应商 *" value={supplier} onChangeText={setSupplier} placeholder="如：华东服饰批发" />
        <Text style={{ color: colors.sub, fontSize: font.sm, marginBottom: 6 }}>选择商品与数量（已选 {pickedCount} 件）</Text>
        <ScrollView style={{ maxHeight: 300 }}>
          {products.filter((p) => p.type === 'physical').map((p) =>
            p.hasVariants ? (
              p.variants.map((v) => (
                <View key={`v${v.id}`} style={[st.card, { flexDirection: 'row', alignItems: 'center', gap: 10 }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontWeight: '600' }} numberOfLines={1}>
                      {p.name}（{[v.option1, v.option2, v.option3].filter(Boolean).join(' / ') || '默认'}）
                    </Text>
                    <Text style={{ color: colors.sub, fontSize: font.xs }}>库存 {v.stock ?? '-'}</Text>
                  </View>
                  <Stepper value={pickQty[`v${v.id}`] ?? 0} onChange={(q) => setPickQty((m) => ({ ...m, [`v${v.id}`]: Math.max(0, q) }))} />
                  <Field
                    testID={`po-unit-cost-v${v.id}`}
                    label="单位成本 *"
                    value={unitCosts[`v${v.id}`] ?? ''}
                    onChangeText={(value) => setUnitCosts((current) => ({ ...current, [`v${v.id}`]: value }))}
                    keyboardType="decimal-pad"
                  />
                </View>
              ))
            ) : (
              <View key={`p${p.id}`} style={[st.card, { flexDirection: 'row', alignItems: 'center', gap: 10 }]}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontWeight: '600' }} numberOfLines={1}>{p.name}</Text>
                  <Text style={{ color: colors.sub, fontSize: font.xs }}>库存 {p.stock ?? '-'}</Text>
                </View>
                <Stepper value={pickQty[`p${p.id}`] ?? 0} onChange={(q) => setPickQty((m) => ({ ...m, [`p${p.id}`]: Math.max(0, q) }))} />
                <Field
                  testID={`po-unit-cost-p${p.id}`}
                  label="单位成本 *"
                  value={unitCosts[`p${p.id}`] ?? ''}
                  onChangeText={(value) => setUnitCosts((current) => ({ ...current, [`p${p.id}`]: value }))}
                  keyboardType="decimal-pad"
                />
              </View>
            )
          )}
        </ScrollView>
        <KV
          k="入库库位"
          v={
            selectedPoLocation === null
              ? '未选择'
              : purchaseLocations?.find((location) => location.id === selectedPoLocation)?.name ??
                `库位 ${selectedPoLocation}`
          }
        />
        <Btn title="创建采购单" loading={busy} onPress={createPo} style={{ marginTop: 8 }} />
      </Sheet>

      <Sheet visible={transferSheet} onClose={() => setTransferSheet(false)} title="创建库位调拨">
        <Text style={{ color: colors.sub, fontSize: font.sm, marginBottom: 6 }}>调出库位</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          {(transferLocations ?? []).filter((location) => location.isActive !== false).map((location) => (
            <Btn key={`from-${location.id}`} title={location.name} size="sm" kind={transferFrom === location.id ? 'primary' : 'outline'} onPress={() => setTransferFrom(location.id)} />
          ))}
        </View>
        <Text style={{ color: colors.sub, fontSize: font.sm, marginBottom: 6 }}>调入库位</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          {(transferLocations ?? []).filter((location) => location.isActive !== false).map((location) => (
            <Btn key={`to-${location.id}`} title={location.name} size="sm" kind={transferTo === location.id ? 'primary' : 'outline'} onPress={() => setTransferTo(location.id)} />
          ))}
        </View>
        <Field label="备注（可选）" value={transferNote} onChangeText={setTransferNote} />
        <ScrollView style={{ maxHeight: 260 }}>
          {products.filter((product) => product.type === 'physical').flatMap((product) =>
            product.hasVariants
              ? product.variants.map((variant) => ({
                  key: `v${variant.id}`,
                  label: `${product.name}（${[variant.option1, variant.option2, variant.option3].filter(Boolean).join(' / ') || '默认'}）`,
                }))
              : [{ key: `p${product.id}`, label: product.name }]
          ).map((item) => (
            <View key={item.key} style={[st.card, { flexDirection: 'row', alignItems: 'center', gap: 10 }]}>
              <Text style={{ color: colors.text, flex: 1 }} numberOfLines={1}>{item.label}</Text>
              <Stepper value={transferQty[item.key] ?? 0} onChange={(quantity) => setTransferQty((current) => ({ ...current, [item.key]: Math.max(0, quantity) }))} />
            </View>
          ))}
        </ScrollView>
        <Text style={{ color: colors.sub, fontSize: font.xs, marginBottom: 8 }}>
          POS 仅创建待审批调拨；审批与完成操作在 TradingWEB 管理端执行。
        </Text>
        <Btn title="提交调拨" loading={busy} onPress={createTransfer} />
      </Sheet>

      <ManagerPinGate
        visible={!!gatePo}
        actionLabel="采购收货入库"
        approvalMode="server"
        operation="receive"
        resourceHash={gatePo && settings.storeId
          ? hashPosApprovalRequest({ purchase_order_id: gatePo.id, store_id: settings.storeId })
          : undefined}
        onClose={() => setGatePo(null)}
        onApproved={(approval) => {
          if (gatePo) doReceive(gatePo, approval.managerName, approval.token);
          setGatePo(null);
        }}
      />
    </View>
  );
}
