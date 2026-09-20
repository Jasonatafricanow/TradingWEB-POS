import React, { useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';

import { errorMessage, getDataSource } from '@/api';
import { Btn, Card, Field, KV, SectionTitle, Segment, Sheet } from '@/components/ui';
import { PrinterManager } from '@/hardware/printer/PrinterManager';
import { buildShiftReceipt, docToPlainText } from '@/hardware/printer/receipt';
import { auditLog, useAudit } from '@/stores/audit';
import { useAuth } from '@/stores/auth';
import { useSettings } from '@/stores/settings';
import { useShift } from '@/stores/shift';
import { colors, font } from '@/theme';
import { CURRENCY_SYMBOL, formatCents, parseUserAmountToCents } from '@/utils/money';

export default function Shift() {
  const shift = useShift();
  const settings = useSettings();
  const staff = useAuth((state) => state.currentStaff);
  const symbol = CURRENCY_SYMBOL[settings.currency];
  const [floatText, setFloatText] = useState('');
  const [moveSheet, setMoveSheet] = useState(false);
  const [moveKind, setMoveKind] = useState<'in' | 'out'>('in');
  const [moveLabel, setMoveLabel] = useState('');
  const [moveAmount, setMoveAmount] = useState('');
  const [closeSheet, setCloseSheet] = useState(false);
  const [countedText, setCountedText] = useState('');
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const receiptContext = () => ({
    storeName: settings.store.name,
    storeAddress: settings.store.address,
    footer: settings.store.footer,
    symbol,
    widthCols: settings.printer.widthCols,
  });

  const uploadAuditInBackground = () => {
    void useAudit.getState().uploadUnsynced(getDataSource()).catch(() => {});
  };

  const printSummary = async () => {
    if (!shift.lastSummary) return;
    try {
      await PrinterManager.printDoc(buildShiftReceipt(shift.lastSummary, receiptContext()));
    } catch (error) {
      Alert.alert('打印失败', errorMessage(error));
    }
  };

  if (!shift.open) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16 }}>
        <Card>
          <Text style={{ fontSize: font.lg, fontWeight: '700', color: colors.text, marginBottom: 10 }}>开班</Text>
          <Field
            label={`备用金（${symbol}）`}
            value={floatText}
            onChangeText={setFloatText}
            keyboardType="decimal-pad"
            placeholder="钱箱起始现金"
          />
          <Btn
            title="开始营业"
            size="lg"
            loading={busy}
            onPress={async () => {
              const cents = parseUserAmountToCents(floatText) ?? 0;
              setBusy(true);
              try {
                await shift.openShiftWithSource(getDataSource(), cents, staff?.name ?? '-');
                auditLog('shift_open', `开班，备用金 ${formatCents(cents, symbol)}`, staff?.name ?? '-');
                uploadAuditInBackground();
                setFloatText('');
              } catch (error) {
                Alert.alert('开班失败', errorMessage(error));
              } finally {
                setBusy(false);
              }
            }}
          />
        </Card>

        {shift.lastSummary && (
          <>
            <SectionTitle text="上次交班" />
            <Card>
              <KV k="交班时间" v={new Date(shift.lastSummary.closedAt).toLocaleString()} />
              {shift.lastSummary.accountingSource !== 'server' && (
                <>
                  <KV k="订单数" v={String(shift.lastSummary.ordersCount)} />
                  <KV k="销售总额" v={formatCents(shift.lastSummary.salesTotalCents, symbol)} />
                </>
              )}
              <KV k="应有现金" v={formatCents(shift.lastSummary.expectedCents, symbol)} />
              <KV k="实点现金" v={formatCents(shift.lastSummary.countedCents, symbol)} />
              <KV
                k="差额"
                v={formatCents(shift.lastSummary.diffCents, symbol)}
                bold
                tone={shift.lastSummary.diffCents === 0 ? 'success' : 'danger'}
              />
              {shift.lastSummary.accountingSource === 'server' && (
                <Text style={{ color: colors.sub, marginTop: 6 }}>以上现金对账结果来自 TradingWEB。</Text>
              )}
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
                <Btn title="打印交班单" kind="outline" size="sm" style={{ flex: 1 }} onPress={printSummary} />
                <Btn
                  title="预览"
                  kind="ghost"
                  size="sm"
                  style={{ flex: 1 }}
                  onPress={() => setPreviewText(docToPlainText(
                    buildShiftReceipt(shift.lastSummary!, receiptContext()),
                    settings.printer.widthCols,
                  ))}
                />
              </View>
            </Card>
          </>
        )}
        <Sheet visible={previewText !== null} onClose={() => setPreviewText(null)} title="交班单预览">
          <ScrollView style={{ maxHeight: 460, backgroundColor: '#fff', borderRadius: 8, padding: 12 }}>
            <Text style={{ fontFamily: 'monospace', fontSize: 12, color: '#000' }}>{previewText}</Text>
          </ScrollView>
        </Sheet>
      </ScrollView>
    );
  }

  const serverAccounting = shift.accountingSource === 'server';
  const expected = shift.expectedCashCents();
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 60 }}>
      <Card>
        <KV k="开班人" v={`${shift.openedBy} · ${shift.openedAt ? new Date(shift.openedAt).toLocaleTimeString() : ''}`} />
        {serverAccounting ? (
          <Text style={{ color: colors.sub }}>订单和现金对账由 TradingWEB 在关班时统一核算。</Text>
        ) : (
          <>
            <KV k="订单数" v={String(shift.ordersCount)} />
            <KV k="销售总额" v={formatCents(shift.salesTotalCents, symbol)} bold />
          </>
        )}
      </Card>

      <SectionTitle text="现金抽屉" />
      <Card>
        <KV k="备用金" v={formatCents(shift.floatCents, symbol)} />
        {!serverAccounting && <KV k="现金销售" v={formatCents(shift.cashSalesCents, symbol)} tone="success" />}
        {!serverAccounting && <KV k="现金退款" v={`-${formatCents(shift.cashRefundCents, symbol)}`} tone="danger" />}
        {shift.movements.map((movement) => (
          <KV
            key={movement.id}
            k={`${movement.kind === 'in' ? '投入' : '取出'} · ${movement.label}（${movement.by}）`}
            v={`${movement.kind === 'in' ? '' : '-'}${formatCents(movement.amountCents, symbol)}`}
          />
        ))}
        {serverAccounting ? (
          <Text style={{ color: colors.sub, marginTop: 8 }}>应有现金将在交班时由服务器按交易明细核算。</Text>
        ) : (
          <KV k="应有现金" v={formatCents(expected, symbol)} bold />
        )}
      </Card>

      <View style={{ gap: 10, marginTop: 6 }}>
        <Btn
          title="现金投入 / 取出"
          kind="outline"
          onPress={() => {
            setMoveKind(shift.pendingCashMovement?.kind ?? 'in');
            setMoveLabel(shift.pendingCashMovement?.label ?? '');
            setMoveAmount(shift.pendingCashMovement
              ? (shift.pendingCashMovement.amountCents / 100).toFixed(2)
              : '');
            setMoveSheet(true);
          }}
        />
        <Btn
          title="打开钱箱"
          kind="outline"
          onPress={async () => {
            try {
              await PrinterManager.openDrawer();
            } catch (error) {
              Alert.alert('无法打开钱箱', errorMessage(error));
            }
          }}
        />
        <Btn
          title="交班盘点"
          kind="danger"
          size="lg"
          onPress={() => {
            setCountedText(shift.pendingClose
              ? (shift.pendingClose.countedCents / 100).toFixed(2)
              : serverAccounting ? '' : (expected / 100).toFixed(2));
            setCloseSheet(true);
          }}
        />
      </View>

      <Sheet visible={moveSheet} onClose={() => setMoveSheet(false)} title="现金投入 / 取出">
        <Segment
          options={[{ value: 'in' as const, label: '投入 +' }, { value: 'out' as const, label: '取出 −' }]}
          value={moveKind}
          onChange={setMoveKind}
        />
        <Field
          label="事由"
          value={moveLabel}
          onChangeText={setMoveLabel}
          placeholder={moveKind === 'in' ? '如：兑换零钱' : '如：上缴现金'}
        />
        <Field label={`金额（${symbol}）`} value={moveAmount} onChangeText={setMoveAmount} keyboardType="decimal-pad" />
        <Btn
          title="记录"
          loading={busy}
          onPress={async () => {
            const cents = parseUserAmountToCents(moveAmount);
            if (cents === null || cents <= 0) {
              Alert.alert('提示', '请输入有效金额');
              return;
            }
            const reason = moveLabel.trim() || (moveKind === 'in' ? '现金投入' : '现金取出');
            setBusy(true);
            try {
              await shift.recordCashMovementWithSource(
                getDataSource(), moveKind, reason, cents, staff?.name ?? '-',
              );
              auditLog('cash_move', `${reason} ${formatCents(cents, symbol)}`, staff?.name ?? '-');
              uploadAuditInBackground();
              setMoveSheet(false);
            } catch (error) {
              Alert.alert('现金动作失败', errorMessage(error));
            } finally {
              setBusy(false);
            }
          }}
        />
      </Sheet>

      <Sheet visible={closeSheet} onClose={() => setCloseSheet(false)} title="交班盘点">
        {serverAccounting ? (
          <Text style={{ color: colors.sub, marginBottom: 12 }}>服务器将在确认后返回最终应有、实点和差额。</Text>
        ) : (
          <KV k="应有现金" v={formatCents(expected, symbol)} bold />
        )}
        <Field label={`实点现金（${symbol}）`} value={countedText} onChangeText={setCountedText} keyboardType="decimal-pad" />
        {!serverAccounting && (() => {
          const counted = parseUserAmountToCents(countedText);
          if (counted === null) return null;
          const difference = counted - expected;
          return (
            <Text style={{ color: difference === 0 ? colors.success : colors.danger, fontWeight: '700', marginBottom: 12 }}>
              差额 {formatCents(difference, symbol)}
            </Text>
          );
        })()}
        <Btn
          title="确认交班"
          kind="danger"
          loading={busy}
          onPress={async () => {
            const counted = parseUserAmountToCents(countedText);
            if (counted === null) {
              Alert.alert('提示', '请输入实点金额');
              return;
            }
            setBusy(true);
            try {
              const summary = await shift.closeShiftWithSource(getDataSource(), counted, staff?.name ?? '-');
              auditLog(
                'shift_close',
                `交班，应有 ${formatCents(summary.expectedCents, symbol)}，实点 ${formatCents(summary.countedCents, symbol)}，差额 ${formatCents(summary.diffCents, symbol)}`,
                staff?.name ?? '-',
              );
              uploadAuditInBackground();
              setCloseSheet(false);
              Alert.alert('已交班', `差额 ${formatCents(summary.diffCents, symbol)}`);
            } catch (error) {
              Alert.alert('交班失败', errorMessage(error));
            } finally {
              setBusy(false);
            }
          }}
        />
      </Sheet>
    </ScrollView>
  );
}
