// 店长审批弹层：店员触发敏感操作（折扣/退款）时要求店长 PIN。
// Mock 模式保留本地演示 PIN；TradingWEB 模式在服务端审批链闭环前严格 fail-closed。

import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { Btn, Field, Sheet } from '@/components/ui';
import type { EntityId } from '@/api/types';
import { useAuth } from '@/stores/auth';
import { colors } from '@/theme';
import { useSettings } from '@/stores/settings';
import { requestApproval } from '@/services/operatorSession';
import {
  localPinFailureMessage,
  managerApprovalErrorMessage,
  managerApprovalTitle,
  useI18n,
} from '@/i18n';

export interface ManagerApproval {
  managerName: string;
  token: string | null;
}

export function ManagerPinGate({
  visible, actionLabel, approvalMode = 'local', operation, resourceHash, onClose, onApproved,
}: {
  visible: boolean;
  actionLabel: string;
  approvalMode?: 'local' | 'server';
  operation?: string;
  resourceHash?: string;
  onClose: () => void;
  onApproved: (approval: ManagerApproval) => void;
}) {
  const { locale, t } = useI18n();
  const staffList = useAuth((s) => s.staffList);
  const dataSource = useSettings((s) => s.dataSource);
  const managers = useMemo(() => staffList.filter((s) => s.role !== 'staff'), [staffList]);
  const [managerId, setManagerId] = useState<EntityId | null>(null);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible) {
      setPin('');
      setBusy(false);
      setManagerId(managers[0]?.id ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  if (dataSource === 'tradingweb' && approvalMode !== 'server') {
    return (
      <Sheet visible={visible} onClose={onClose} title={managerApprovalTitle(locale, actionLabel)}>
        <Text testID="manager-pin-gate-unsupported" style={{ color: colors.danger, marginBottom: 12, lineHeight: 20 }}>
          {t('manager.unsupported_title')}
        </Text>
        <Text style={{ color: colors.sub, marginBottom: 12, lineHeight: 20 }}>
          {t('manager.unsupported_body')}
        </Text>
        <Btn title={t('manager.close')} kind="outline" onPress={onClose} />
      </Sheet>
    );
  }

  if (managers.length === 0) {
    return (
      <Sheet visible={visible} onClose={onClose} title={managerApprovalTitle(locale, actionLabel)}>
        <Text testID="manager-pin-gate-no-approver" style={{ color: colors.danger, marginBottom: 12, lineHeight: 20 }}>
          {t('manager.no_approver_title')}
        </Text>
        <Text style={{ color: colors.sub, marginBottom: 12, lineHeight: 20 }}>
          {t('manager.no_approver_body')}
        </Text>
        <Btn title={t('manager.close')} kind="outline" onPress={onClose} />
      </Sheet>
    );
  }

  const confirm = async () => {
    const m = managers.find((x) => x.id === (managerId ?? managers[0]?.id));
    if (!m) return;
    if (dataSource === 'tradingweb') {
      if (!operation || !resourceHash) {
        setPin('');
        Alert.alert(t('manager.failure_title'), t('manager.missing_request'));
        return;
      }
      setBusy(true);
      try {
        const token = await requestApproval(operation, resourceHash, m.id, pin);
        setPin('');
        onApproved({ managerName: m.name, token });
        onClose();
      } catch (error) {
        setPin('');
        Alert.alert(
          t('manager.failure_title'),
          managerApprovalErrorMessage(locale, error),
        );
      } finally {
        setBusy(false);
      }
      return;
    }
    const r = useAuth.getState().verifyPin(m.id, pin);
    if (r.ok) {
      onApproved({ managerName: m.name, token: null });
      onClose();
    } else {
      setPin('');
      Alert.alert(t('manager.failure_title'), localPinFailureMessage(locale, r));
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={managerApprovalTitle(locale, actionLabel)}>
      <Text style={{ color: colors.sub, marginBottom: 10 }}>{t('manager.requires')}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        {managers.map((m) => {
          const active = m.id === (managerId ?? managers[0]?.id);
          return (
            <Pressable
              key={m.id}
              onPress={() => setManagerId(m.id)}
              style={{
                paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999,
                backgroundColor: active ? colors.primary : colors.primarySoft,
              }}
            >
              <Text style={{ color: active ? '#fff' : colors.primary, fontWeight: '600' }}>{m.name}</Text>
            </Pressable>
          );
        })}
      </View>
      <Field testID="manager-pin-input" label={t('manager.pin_label')} value={pin} onChangeText={setPin} keyboardType="number-pad" secureTextEntry placeholder="••••" />
      <Btn testID="manager-pin-confirm" title={t('manager.authorize')} loading={busy} onPress={confirm} />
    </Sheet>
  );
}
