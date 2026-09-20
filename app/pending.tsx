import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Alert, FlatList, Text, View } from 'react-native';
import { Btn, Card, Empty } from '@/components/ui';
import { ManagerPinGate } from '@/components/ManagerPinGate';
import { hashPosApprovalRequest } from '@/services/posRequests';
import { auditLog } from '@/stores/audit';
import { useAuth } from '@/stores/auth';
import { usePending } from '@/stores/pending';
import type { PendingOrder } from '@/stores/pending';
import { useSettings } from '@/stores/settings';
import { requireAccountReauthentication } from '@/services/operatorSession';
import { colors, font } from '@/theme';
import { CURRENCY_SYMBOL, formatCents } from '@/utils/money';
import {
  formatDateTime,
  pendingAuditDescription,
  pendingErrorMessage,
  useI18n,
} from '@/i18n';
import { LOW_END_LIST_PROPS } from '@/components/listPolicy';

export default function Pending() {
  const router = useRouter();
  const { locale, t } = useI18n();
  const pending = usePending();
  const settings = useSettings();
  const staffName = useAuth((state) => state.currentStaff?.name);
  const symbol = CURRENCY_SYMBOL[settings.currency];
  const [busy, setBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<PendingOrder | null>(null);

  const reauthenticate = async (pendingId: string) => {
    setBusy(true);
    try {
      const cleanup = await requireAccountReauthentication();
      if (cleanup.cleanupError) {
        console.warn('Operator session revoke failed during reauthentication.', cleanup.cleanupError);
        Alert.alert(t('pending.session_cleanup_title'), t('pending.session_cleanup_body'));
      }
      router.replace({ pathname: '/login', params: { reauthPendingId: pendingId } });
    } catch {
      Alert.alert(t('pending.reauth_failed_title'), t('pending.reauth_failed_body'));
    } finally {
      setBusy(false);
    }
  };

  const syncNow = async () => {
    if (settings.dataSource !== 'tradingweb') {
      Alert.alert(t('pending.demo_title'), t('pending.demo_body'));
      return;
    }
    setBusy(true);
    try {
      const result = await pending.syncAll();
      Alert.alert(
        t('pending.sync_complete_title'),
        t('pending.sync_complete_body', { ok: result.ok, fail: result.fail }),
      );
    } finally {
      setBusy(false);
    }
  };

  const syncOne = async (pendingId: string) => {
    if (settings.dataSource !== 'tradingweb') return;
    setBusy(true);
    try {
      const result = await pending.syncOne(pendingId);
      Alert.alert(
        t('pending.sync_complete_title'),
        t('pending.sync_complete_body', { ok: result.ok, fail: result.fail }),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <FlatList
        {...LOW_END_LIST_PROPS}
        data={pending.items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 120 }}
        ListEmptyComponent={<Empty text={t('pending.empty')} />}
        renderItem={({ item }) => (
          <Card>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontWeight: '700', color: colors.text }}>{item.idempotencyKey}</Text>
              <Text style={{ fontWeight: '800', color: colors.text }}>{formatCents(item.request.totalCents, symbol)}</Text>
            </View>
            <Text style={{ color: colors.sub, fontSize: font.xs, marginTop: 4 }}>
              {t('pending.item_meta', {
                date: formatDateTime(locale, new Date(item.createdAt), {
                  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                }),
                count: item.request.items.reduce((sum, line) => sum + line.qty, 0),
                attempts: item.attempts,
              })}
            </Text>
            <Text style={{ color: item.status === 'blocked' ? colors.danger : colors.sub, fontSize: font.xs, marginTop: 4 }} numberOfLines={2}>
              {pendingErrorMessage(locale, item.lastError, item.idempotencyKey)}
            </Text>
            {item.status === 'pending' && <Btn title={t('pending.retry_now')} size="sm" style={{ marginTop: 8 }} disabled={busy || pending.syncing} onPress={() => void syncOne(item.id)} />}
            {item.status === 'syncing' && <Text style={{ color: colors.sub, fontSize: font.xs, marginTop: 8 }}>{t('pending.syncing')}</Text>}
            {item.status === 'blocked' && item.lastError.status === 401 && (
              <Btn title={t('pending.reauthenticate')} size="sm" style={{ marginTop: 8 }} disabled={busy} onPress={() => void reauthenticate(item.id)} />
            )}
            <Btn
              title={t('pending.delete_action')}
              kind="ghost"
              size="sm"
              style={{ marginTop: 8 }}
              disabled={busy || pending.syncing || item.status === 'syncing'}
              onPress={() =>
                Alert.alert(t('pending.delete_title'), t('pending.delete_body'), [
                  { text: t('pending.cancel') },
                  {
                    text: t('pending.delete'),
                    style: 'destructive',
                    onPress: () => setDeleteTarget(item),
                  },
                ])
              }
            />
          </Card>
        )}
      />
      <ManagerPinGate
        visible={deleteTarget !== null}
        actionLabel={t('pending.delete_gate_action')}
        approvalMode="server"
        operation="pending_delete"
        resourceHash={deleteTarget && settings.storeId
          ? hashPosApprovalRequest({
              idempotency_key: deleteTarget.idempotencyKey,
              store_id: settings.storeId,
            })
          : undefined}
        onClose={() => setDeleteTarget(null)}
        onApproved={(approval) => {
          const target = deleteTarget;
          setDeleteTarget(null);
          if (!target) return;
          if (pending.remove(target.id)) {
            auditLog(
              'pending_delete',
              pendingAuditDescription(
                locale,
                target.idempotencyKey,
                formatCents(target.request.totalCents, symbol),
              ),
              staffName ?? '-',
              approval.managerName || null,
            );
          }
        }}
      />
      {pending.items.length > 0 && (
        <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: 14, paddingBottom: 20, backgroundColor: colors.card, borderTopWidth: 1, borderColor: colors.border }}>
          <Btn title={t('pending.sync_all', { count: pending.items.length })} size="lg" loading={busy || pending.syncing} onPress={syncNow} />
        </View>
      )}
    </View>
  );
}
