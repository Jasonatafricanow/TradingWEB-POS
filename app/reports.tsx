import React, { useCallback, useRef, useState } from 'react';
import { Alert, RefreshControl, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { errorMessage, getDataSource } from '@/api';
import type { PosRangeReport } from '@/api/types';
import { Card, KV, SectionTitle } from '@/components/ui';
import { usePending } from '@/stores/pending';
import { useSettings } from '@/stores/settings';
import { useShift } from '@/stores/shift';
import { colors, font } from '@/theme';
import { CURRENCY_SYMBOL, formatCents } from '@/utils/money';
import { localDayKey, posRangeReportToCsv } from '@/utils/report';

type RangeMode = 'today' | '7d' | '30d';
const MODES: { key: RangeMode; label: string }[] = [
  { key: 'today', label: '今日' },
  { key: '7d', label: '近 7 天' },
  { key: '30d', label: '近 30 天' },
];

function rangeFor(mode: RangeMode, now = new Date()) {
  const days = mode === 'today' ? 1 : mode === '7d' ? 7 : 30;
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days + 1);
  return { dateFrom: localDayKey(start), dateTo: localDayKey(now), days };
}

function Bar({ ratio }: { ratio: number }) {
  return (
    <View style={{ height: 6, backgroundColor: colors.border, borderRadius: 3, marginTop: 4, marginBottom: 8 }}>
      <View style={{ height: 6, width: `${Math.max(2, Math.round(Math.max(0, ratio) * 100))}%`, backgroundColor: colors.primary, borderRadius: 3 }} />
    </View>
  );
}

export default function Reports() {
  const settings = useSettings();
  const shift = useShift();
  const pendingCount = usePending((state) => state.items.length);
  const symbol = CURRENCY_SYMBOL[settings.currency];
  const [report, setReport] = useState<PosRangeReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<RangeMode>('today');
  const requestSequence = useRef(0);
  const range = rangeFor(mode);

  const load = useCallback(async () => {
    const sequence = ++requestSequence.current;
    setLoading(true);
    try {
      const next = await getDataSource().fetchRangeReport({ dateFrom: range.dateFrom, dateTo: range.dateTo, source: 'pos' });
      if (sequence === requestSequence.current) setReport(next);
    } catch (error) {
      if (sequence === requestSequence.current) Alert.alert('加载失败', errorMessage(error));
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [range.dateFrom, range.dateTo]);

  useFocusEffect(useCallback(() => {
    load();
    return () => { requestSequence.current += 1; };
  }, [load]));

  const onExport = useCallback(async () => {
    if (!report) return;
    try {
      if (!FileSystem.cacheDirectory) throw new Error('设备未提供可写缓存目录');
      if (!(await Sharing.isAvailableAsync())) throw new Error('当前设备不支持文件分享');
      const uri = `${FileSystem.cacheDirectory}pos-report-${report.startKey}-${report.endKey}.csv`;
      await FileSystem.writeAsStringAsync(uri, `\ufeff${posRangeReportToCsv(report)}`, { encoding: FileSystem.EncodingType.UTF8 });
      await Sharing.shareAsync(uri, { mimeType: 'text/csv', dialogTitle: '导出 POS 报表' });
    } catch (error) {
      Alert.alert('导出失败', errorMessage(error));
    }
  }, [report]);

  const payMax = Math.max(1, ...(report?.byPayment.map((row) => Math.abs(row.netCents)) ?? []));
  const itemMax = Math.max(1, ...(report?.topItems.map((row) => row.qty) ?? []));
  const trendMax = Math.max(1, ...(report?.daily.map((row) => Math.abs(row.netCents)) ?? []));

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: 16, paddingBottom: 60 }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
    >
      <View style={{ flexDirection: 'row', backgroundColor: colors.card, borderRadius: 10, padding: 4, marginBottom: 12, borderWidth: 1, borderColor: colors.border }}>
        {MODES.map((item) => {
          const active = item.key === mode;
          return (
            <TouchableOpacity key={item.key} onPress={() => setMode(item.key)} style={{ flex: 1, paddingVertical: 8, borderRadius: 8, backgroundColor: active ? colors.primary : 'transparent', alignItems: 'center' }}>
              <Text style={{ color: active ? '#fff' : colors.sub, fontSize: font.sm, fontWeight: active ? '800' : '600' }}>{item.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <SectionTitle text={`概览 · ${range.dateFrom} ~ ${range.dateTo}`} />
        <TouchableOpacity onPress={onExport} disabled={!report} style={{ paddingVertical: 4, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, borderColor: colors.border, opacity: report ? 1 : 0.4 }}>
          <Text style={{ color: colors.primary, fontSize: font.sm, fontWeight: '700' }}>导出 CSV</Text>
        </TouchableOpacity>
      </View>

      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 8 }}>
          <View style={{ alignItems: 'center' }}>
            <Text style={{ fontSize: font.xxl, fontWeight: '800', color: colors.text }}>{report ? formatCents(report.netCents, symbol) : '-'}</Text>
            <Text style={{ color: colors.sub, fontSize: font.xs, marginTop: 2 }}>净销售额</Text>
          </View>
          <View style={{ alignItems: 'center' }}>
            <Text style={{ fontSize: font.xxl, fontWeight: '800', color: colors.text }}>{report?.ordersCount ?? '-'}</Text>
            <Text style={{ color: colors.sub, fontSize: font.xs, marginTop: 2 }}>订单数</Text>
          </View>
        </View>
        <KV k="销售总额" v={report ? formatCents(report.grossCents, symbol) : '-'} />
        <KV k="区间内退款" v={report ? `-${formatCents(report.refundedCents, symbol)}` : '-'} tone="danger" />
        {report && report.refundsForOrdersCents !== report.refundedCents && (
          <KV k="区间订单最终退款" v={`-${formatCents(report.refundsForOrdersCents, symbol)}`} tone="danger" />
        )}
        <KV k="客单价" v={report ? formatCents(report.avgOrderCents, symbol) : '-'} />
        {mode !== 'today' && <KV k="覆盖天数" v={`${range.days} 天`} />}
        {report && <KV k="门店时区" v={`${report.store.name} · UTC${report.store.timezoneOffset}`} />}
        {pendingCount > 0 && <KV k="待同步订单（未计入服务器）" v={String(pendingCount)} tone="danger" />}
        <Text style={{ color: colors.sub, fontSize: font.xs, marginTop: 6 }}>
          {settings.dataSource === 'tradingweb' ? '统计范围：TradingWEB 服务端完整区间数据。' : '统计范围：本机演示数据。'}
        </Text>
      </Card>

      {report && report.daily.length > 1 && (
        <>
          <SectionTitle text="每日净销售趋势" />
          <Card>
            {report.daily.map((row) => (
              <View key={row.dateKey}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: colors.sub, fontSize: font.xs }}>{row.dateKey.slice(5)}</Text>
                  <Text style={{ color: colors.text, fontSize: font.xs }}>{formatCents(row.netCents, symbol)} · {row.ordersCount} 单</Text>
                </View>
                <Bar ratio={Math.abs(row.netCents) / trendMax} />
              </View>
            ))}
          </Card>
        </>
      )}

      <SectionTitle text="支付方式分布" />
      <Card>
        {report && report.byPayment.length > 0 ? report.byPayment.map((row) => (
          <View key={`${row.method}:${row.label}`}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ color: colors.text, fontSize: font.sm }}>{row.label}</Text>
              <Text style={{ color: colors.text, fontSize: font.sm, fontWeight: '700' }}>{formatCents(row.netCents, symbol)}</Text>
            </View>
            <Bar ratio={Math.abs(row.netCents) / payMax} />
          </View>
        )) : <Text style={{ color: colors.sub }}>该区间暂无收款</Text>}
      </Card>

      <SectionTitle text="热销商品 Top 20" />
      <Card>
        {report && report.topItems.length > 0 ? report.topItems.map((item, index) => (
          <View key={item.name}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ color: colors.text, fontSize: font.sm, flex: 1 }} numberOfLines={1}>{index + 1}. {item.name}</Text>
              <Text style={{ color: colors.sub, fontSize: font.sm }}>{item.qty} 件 · {formatCents(item.amountCents, symbol)}</Text>
            </View>
            <Bar ratio={item.qty / itemMax} />
          </View>
        )) : <Text style={{ color: colors.sub }}>该区间暂无销售</Text>}
      </Card>

      <SectionTitle text={mode === 'today' ? '员工业绩（今日）' : '员工业绩（区间）'} />
      <Card>
        {report && report.byStaff.length > 0 ? report.byStaff.map((staff) => (
          <View key={staff.staffId ?? staff.name} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 5 }}>
            <Text style={{ color: colors.text, fontSize: font.sm, fontWeight: '600', flex: 1 }} numberOfLines={1}>{staff.name}</Text>
            <Text style={{ color: colors.sub, fontSize: font.sm }}>{staff.orders} 单 · {formatCents(staff.netCents, symbol)}{staff.refundedCents > 0 ? ` · 退 ${formatCents(staff.refundedCents, symbol)}` : ''}</Text>
          </View>
        )) : <Text style={{ color: colors.sub }}>该区间暂无销售</Text>}
      </Card>

      <SectionTitle text="本班次" />
      <Card>
        {shift.open ? (
          <>
            <KV k="开班" v={`${shift.openedBy} · ${shift.openedAt ? new Date(shift.openedAt).toLocaleTimeString() : ''}`} />
            <KV k="班次订单" v={String(shift.ordersCount)} />
            <KV k="班次销售" v={formatCents(shift.salesTotalCents, symbol)} bold />
            <KV k="应有现金" v={formatCents(shift.expectedCashCents(), symbol)} />
          </>
        ) : <Text style={{ color: colors.sub }}>未开班</Text>}
      </Card>
    </ScrollView>
  );
}
