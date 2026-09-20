// 更多：交接班 / 硬件 / 设置 / 锁定 / 退出

import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Card, Tag } from '@/components/ui';
import { useAuth } from '@/stores/auth';
import { usePending } from '@/stores/pending';
import { useSettings } from '@/stores/settings';
import { useShift } from '@/stores/shift';
import { lockOperator } from '@/services/operatorSession';
import { colors, font } from '@/theme';
import { formatMoney, useI18n } from '@/i18n';

function Row({ icon, title, sub, onPress, danger }: { icon: any; title: string; sub?: string; onPress: () => void; danger?: boolean }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({
      flexDirection: 'row', alignItems: 'center', gap: 12,
      backgroundColor: pressed ? colors.primarySoft : colors.card,
      padding: 16, borderRadius: 12, marginBottom: 10, borderWidth: 1, borderColor: colors.border,
    })}>
      <Ionicons name={icon} size={22} color={danger ? colors.danger : colors.primary} />
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: font.md, fontWeight: '600', color: danger ? colors.danger : colors.text }}>{title}</Text>
        {sub ? <Text style={{ fontSize: font.xs, color: colors.sub, marginTop: 2 }}>{sub}</Text> : null}
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.sub} />
    </Pressable>
  );
}

export default function More() {
  const { locale, t } = useI18n();
  const router = useRouter();
  const auth = useAuth();
  const settings = useSettings();
  const shift = useShift();
  const pendingCount = usePending((s) => s.items.length);
  const salesTotal = formatMoney(locale, shift.salesTotalCents / 100, settings.currency);
  const roleKey = auth.currentStaff?.role === 'manager'
    ? 'more.role.manager'
    : auth.currentStaff?.role === 'admin'
      ? 'more.role.admin'
      : 'more.role.cashier';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <Text style={{ fontSize: font.xl, fontWeight: '800', color: colors.text, marginBottom: 12 }}>{t('more.title')}</Text>

        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontSize: font.lg, fontWeight: '800', color: colors.primary }}>
                {(auth.currentStaff?.name ?? '?').slice(0, 1)}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: font.lg, fontWeight: '700', color: colors.text }}>{auth.currentStaff?.name ?? '-'}</Text>
              <View style={{ flexDirection: 'row', gap: 6, marginTop: 4 }}>
                <Tag text={t(roleKey)} tone="primary" />
                <Tag text={settings.dataSource === 'tradingweb' ? `TradingWEB · ${settings.serverUrl.replace(/^https?:\/\//, '')}` : t('more.demo_mode')} tone={settings.dataSource === 'tradingweb' ? 'success' : 'warn'} />
              </View>
            </View>
          </View>
        </Card>

        <Row
          icon="cash"
          title={t('more.shift')}
          sub={shift.open ? t('more.shift_open', { orders: shift.ordersCount, sales: salesTotal }) : t('more.shift_closed')}
          onPress={() => router.push('/shift')}
        />
        <Row icon="bar-chart" title={t('more.reports')} sub={t('more.reports_description')} onPress={() => router.push('/reports')} />
        {pendingCount > 0 && (
          <Row
            icon="cloud-upload"
            title={t('more.pending_orders', { count: pendingCount })}
            sub={t('more.pending_description')}
            onPress={() => router.push('/pending')}
            danger
          />
        )}
        <Row icon="cube" title={t('more.purchasing')} sub={t('more.purchasing_description')} onPress={() => router.push('/purchasing')} />
        <Row icon="reader" title={t('more.audit')} sub={t('more.audit_description')} onPress={() => router.push('/audit')} />
        <Row icon="print" title={t('more.hardware')} sub={t('more.hardware_description')} onPress={() => router.push('/settings/hardware')} />
        <Row icon="settings" title={t('more.settings')} sub={t('more.settings_description')} onPress={() => router.push('/settings')} />
        <Row
          icon="document-text"
          title={t('more.backend_notes')}
          sub={t('more.backend_notes_description')}
          onPress={() =>
            Alert.alert(
              t('more.backend_notes'),
              t('more.backend_notes_body')
            )
          }
        />
        <Row
          icon="lock-closed"
          title={t('more.lock')}
          sub={t('more.lock_description')}
          onPress={async () => {
            await lockOperator().catch(() => {});
            auth.lock();
            router.replace('/login');
          }}
        />
        <Row
          icon="log-out"
          title={t('more.sign_out')}
          danger
          onPress={() =>
            Alert.alert(t('more.sign_out_title'), t('more.sign_out_description'), [
              { text: t('common.cancel') },
              {
                text: t('more.sign_out'),
                style: 'destructive',
                onPress: async () => {
                  await lockOperator().catch(() => {});
                  await auth.signOut().catch(() => {});
                  router.replace('/login');
                },
              },
            ])
          }
        />
      </ScrollView>
    </SafeAreaView>
  );
}
