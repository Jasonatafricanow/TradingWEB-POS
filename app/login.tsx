// 登录 / PIN 解锁
// 模式一：连接 TradingWEB（/api/auth/login 换 token）
// 模式二：演示模式（内置数据，离线可跑）
// 登录后进入员工 PIN 解锁（对标 Shopify POS 员工 PIN）

import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getDataSourceByKind, localizedErrorMessage } from '@/api';
import type { EntityId } from '@/api';
import { Btn, Card, Field, Segment, Tag } from '@/components/ui';
import { useAuth } from '@/stores/auth';
import { useSettings } from '@/stores/settings';
import { colors, font, radius } from '@/theme';
import { lockOperator } from '@/services/operatorSession';
import { completeTradingWebUnlock } from '@/services/posLogin';
import { canSwitchSource, serverFinancialStateCount } from '@/services/sourceIdentity';
import { useCart } from '@/stores/cart';
import { usePending } from '@/stores/pending';
import { useShift } from '@/stores/shift';
import { useI18n } from '@/i18n';

function PinPad({ onPress, onDelete }: { onPress: (d: string) => void; onDelete: () => void }) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center' }}>
      {keys.map((k, i) => (
        <Pressable
          key={i}
          disabled={k === ''}
          onPress={() => (k === '⌫' ? onDelete() : onPress(k))}
          style={({ pressed }) => ({
            width: '30%',
            margin: '1.5%',
            paddingVertical: 16,
            borderRadius: radius.md,
            backgroundColor: k === '' ? 'transparent' : pressed ? colors.primarySoft : colors.card,
            alignItems: 'center',
            borderWidth: k === '' ? 0 : 1,
            borderColor: colors.border,
          })}
        >
          <Text style={{ fontSize: 22, fontWeight: '700', color: colors.text }}>{k}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export default function Login() {
  const { locale, t } = useI18n();
  const router = useRouter();
  const routeParams = useLocalSearchParams<{ reauthPendingId?: string | string[] }>();
  const reauthPendingId = typeof routeParams.reauthPendingId === 'string' ? routeParams.reauthPendingId : null;
  const auth = useAuth();
  const settings = useSettings();
  const cartBusinessCount = useCart((state) => state.lines.length + state.holds.length + (state.exchange ? 1 : 0));
  const pendingCount = usePending((state) => state.items.length);
  const businessStateCount = cartBusinessCount + pendingCount;
  const financialStateCount = useShift(serverFinancialStateCount);

  const [mode, setMode] = useState<'mock' | 'tradingweb'>(settings.dataSource);
  const [serverUrl, setServerUrl] = useState(settings.serverUrl || 'https://');
  const [storeId, setStoreId] = useState(settings.storeId ?? '');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const [staffId, setStaffId] = useState<EntityId | null>(null);
  const [pin, setPin] = useState('');

  const signedIn = !!auth.token;
  const selectedStaff = useMemo(
    () => auth.staffList.find((s) => s.id === (staffId ?? auth.staffList[0]?.id)),
    [auth.staffList, staffId]
  );

  if (signedIn && !auth.locked && auth.currentStaff) {
    return <Redirect href="/(tabs)" />;
  }

  const doConnect = async () => {
    setBusy(true);
    try {
      if (!canSwitchSource(
        { dataSource: settings.dataSource, serverUrl: settings.serverUrl, storeId: settings.storeId },
        { dataSource: mode, serverUrl: serverUrl.trim(), storeId: mode === 'tradingweb' ? settings.storeId : null },
        businessStateCount,
        financialStateCount,
      )) {
        Alert.alert(t('auth.cannot_switch_source_title'), t('auth.cannot_switch_source_body'));
        return;
      }
      settings.set({ dataSource: mode, serverUrl: serverUrl.trim() });
      const ds = getDataSourceByKind(mode);
      if (mode === 'tradingweb' && (!email.trim() || !password)) {
        Alert.alert(t('auth.credentials_prompt_title'), t('auth.credentials_prompt_body'));
        return;
      }
      const { token, staff } = await ds.login(email.trim() || 'demo', password || 'demo');
      // 先落 token（HttpClient 从 auth store 取 Authorization），再拉员工列表
      auth.signIn(token, staff, [staff]);
      const staffList = await ds.fetchStaff().catch(() => [] as typeof auth.staffList);
      if (staffList.length > 0) auth.setStaffList(staffList);
      const first = staffList[0] ?? staff;
      setStaffId(first.id);
      if (first.storeId) {
        setStoreId(first.storeId);
        settings.set({ storeId: first.storeId });
      }
      setPin('');
    } catch (e) {
      Alert.alert(t('auth.login_failed'), localizedErrorMessage(e, locale));
    } finally {
      setBusy(false);
    }
  };

  const attemptUnlock = async () => {
    const target = selectedStaff;
    if (!target) return;
    setBusy(true);
    try {
      const resolvedStoreId = target.storeId ?? storeId.trim() ?? settings.storeId;
      if (!canSwitchSource(
        { dataSource: settings.dataSource, serverUrl: settings.serverUrl, storeId: settings.storeId },
        { dataSource: settings.dataSource, serverUrl: settings.serverUrl, storeId: resolvedStoreId || null },
        businessStateCount,
        financialStateCount,
      )) {
        Alert.alert(t('auth.cannot_switch_store_title'), t('auth.cannot_switch_store_body'));
        return;
      }
      const r = settings.dataSource === 'tradingweb'
        ? resolvedStoreId
          ? await completeTradingWebUnlock(
              getDataSourceByKind('tradingweb'), target, pin, resolvedStoreId,
            )
          : { ok: false, message: t('auth.store_required') }
        : auth.unlock(target.id, pin);
      if (r.ok) {
        if (settings.dataSource === 'tradingweb' && reauthPendingId) {
          usePending.getState().resumeAfterReauthentication(reauthPendingId);
        }
        setPin('');
        router.replace('/(tabs)');
        return;
      }
      setPin('');
      let failureMessage = t('auth.pin_incorrect');
      if ('code' in r) {
        switch (r.code) {
          case 'PIN_LOCKED_WAIT':
            failureMessage = t('auth.pin_locked_wait', {
              seconds: r.params?.seconds ?? 0,
            });
            break;
          case 'STAFF_NOT_FOUND':
            failureMessage = t('auth.staff_not_found');
            break;
          case 'PIN_TOO_SHORT':
            failureMessage = t('auth.pin_too_short');
            break;
          case 'PIN_LOCKED':
            failureMessage = t('auth.pin_locked', {
              attempts: r.params?.attempts ?? 0,
              seconds: r.params?.seconds ?? 0,
            });
            break;
          case 'PIN_INVALID':
            failureMessage = t('auth.pin_attempts_left', {
              attempts: r.params?.attempts ?? 0,
            });
            break;
        }
      } else if (settings.dataSource === 'tradingweb' && !resolvedStoreId) {
        failureMessage = t('auth.store_required');
      }
      Alert.alert(t('auth.unlock_failed'), failureMessage);
    } catch (error) {
      setPin('');
      Alert.alert(t('auth.unlock_failed'), localizedErrorMessage(error, locale));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 40 }} keyboardShouldPersistTaps="handled">
        <Text style={{ fontSize: font.xxl, fontWeight: '800', color: colors.text, textAlign: 'center' }}>
          TradingWEB POS
        </Text>
        <Text style={{ color: colors.sub, textAlign: 'center', marginTop: 6, marginBottom: 24 }}>
          {t('auth.subtitle')}
        </Text>

        {!signedIn ? (
          <Card>
            <Segment
              options={[
                { value: 'tradingweb' as const, label: t('auth.source_tradingweb') },
                { value: 'mock' as const, label: t('auth.source_demo') },
              ]}
              value={mode}
              onChange={setMode}
            />
            {mode === 'tradingweb' ? (
              <>
                <Field label={t('auth.server_url')} value={serverUrl} onChangeText={setServerUrl} placeholder="https://your-tradingweb.com" keyboardType="url" />
                <Field label={t('auth.email')} value={email} onChangeText={setEmail} placeholder="staff@example.com" keyboardType="email-address" />
                <Field label={t('auth.password')} value={password} onChangeText={setPassword} secureTextEntry placeholder="••••••••" />
              </>
            ) : (
              <Text style={{ color: colors.sub, marginBottom: 12, lineHeight: 20 }}>
                {t('auth.demo_description')}
              </Text>
            )}
            <Btn title={mode === 'tradingweb' ? t('auth.sign_in') : t('auth.enter_demo')} onPress={doConnect} loading={busy} size="lg" />
          </Card>
        ) : (
          <Card>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <Text style={{ fontSize: font.lg, fontWeight: '700', color: colors.text }}>{t('auth.select_staff_pin')}</Text>
              <Tag text={settings.dataSource === 'tradingweb' ? 'TradingWEB' : t('auth.source_demo')} tone={settings.dataSource === 'tradingweb' ? 'primary' : 'warn'} />
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
              {auth.staffList.map((s) => {
                const active = s.id === (staffId ?? auth.staffList[0]?.id);
                return (
                  <Pressable
                    key={s.id}
                    onPress={() => {
                      setStaffId(s.id);
                      setPin('');
                    }}
                    style={{
                      paddingHorizontal: 14,
                      paddingVertical: 8,
                      borderRadius: 999,
                      backgroundColor: active ? colors.primary : colors.primarySoft,
                    }}
                  >
                    <Text style={{ color: active ? '#fff' : colors.primary, fontWeight: '600' }}>{s.name}</Text>
                  </Pressable>
                );
              })}
            </View>
            {selectedStaff?.usesDefaultPin && (
              <Text style={{ color: colors.warn, textAlign: 'center', fontSize: font.xs, marginBottom: 8 }}>
                {t('auth.default_pin_warning')}
              </Text>
            )}
            {settings.dataSource === 'tradingweb' && !selectedStaff?.storeId && (
              <Field
                label={t('auth.store_uuid')}
                value={storeId}
                onChangeText={setStoreId}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                autoCapitalize="none"
              />
            )}
            <Text style={{ textAlign: 'center', fontSize: 28, letterSpacing: 8, marginBottom: 10, color: colors.text }}>
              {pin.length === 0 ? '· · · ·' : '●'.repeat(pin.length)}
            </Text>
            <PinPad onPress={(d) => setPin((pin + d).slice(0, 6))} onDelete={() => setPin(pin.slice(0, -1))} />
            <View style={{ marginTop: 14 }}>
              <Btn title={t('auth.unlock')} size="lg" disabled={pin.length < 4} loading={busy} onPress={attemptUnlock} />
            </View>
            <View style={{ marginTop: 10 }}>
              <Btn title={t('auth.sign_out')} kind="ghost" onPress={async () => {
                await lockOperator().catch(() => {});
                await auth.signOut().catch(() => {});
              }} />
            </View>
          </Card>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
