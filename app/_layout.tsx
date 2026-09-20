import { ErrorBoundary as RouterErrorBoundary, Stack, usePathname, useRouter } from 'expo-router';
import type { ErrorBoundaryProps } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, AppState, InteractionManager, View } from 'react-native';
import { getDataSource } from '@/api';
import { useAuth } from '@/stores/auth';
import { useAudit } from '@/stores/audit';
import { usePending } from '@/stores/pending';
import { useSettings } from '@/stores/settings';
import { useShift } from '@/stores/shift';
import { colors } from '@/theme';
import { getUsableOperatorSessionStaffId, loadOperatorSession } from '@/services/operatorSession';
import { canAutoSyncPending } from '@/services/sync';
import { flushTelemetry, recordTelemetry } from '@/services/telemetry';
import { I18nProvider, useI18n } from '@/i18n';
import { getStackTitles } from '@/i18n/mobile-shell';
import { markPerformance, measurePerformance } from '@/performance/recorder';
import { useStoresHydrated, type PersistedStore } from '@/bootstrap/hydration';
import { createAppLifecycleCoordinator } from '@/services/appLifecycleCoordinator';

markPerformance('app_start');

export function ErrorBoundary(props: ErrorBoundaryProps) {
  useEffect(() => {
    void recordTelemetry({ type: 'app_error', route: 'root', message: props.error.message }).catch(() => {});
  }, [props.error]);
  return <RouterErrorBoundary {...props} />;
}

const SECURITY_STORES = [useAuth, useSettings, useShift] as unknown as readonly PersistedStore[];

/** 等待 AsyncStorage 持久化状态恢复，避免误跳登录页 */
function useHydrated(): boolean {
  return useStoresHydrated(SECURITY_STORES);
}

function RootLayoutContent() {
  const { ready: localeReady, t } = useI18n();
  const stackTitles = getStackTitles(t);
  const hydrated = useHydrated();
  const tokenLoaded = useAuth((s) => s.tokenLoaded);
  const [operatorLoaded, setOperatorLoaded] = useState(false);
  const dataSource = useSettings((s) => s.dataSource);
  const token = useAuth((s) => s.token);
  const locked = useAuth((s) => s.locked);
  const currentStaff = useAuth((s) => s.currentStaff);
  const ready = localeReady && hydrated && tokenLoaded && (dataSource !== 'tradingweb' || operatorLoaded);

  useEffect(() => {
    if (!ready) return;
    markPerformance('security_ready');
    markPerformance('shell_mounted');
    measurePerformance('cold_start', 'app_start', 'shell_mounted');
  }, [ready]);

  // token 从 SecureStore 异步载入（不经 AsyncStorage）
  useEffect(() => {
    useAuth.getState().loadToken();
  }, []);

  useEffect(() => {
    if (!hydrated || dataSource !== 'tradingweb') {
      setOperatorLoaded(true);
      return;
    }
    setOperatorLoaded(false);
    loadOperatorSession()
      .then(async (session) => {
        const auth = useAuth.getState();
        if (!session || session.operator.staffId !== auth.currentStaff?.id) {
          auth.lock();
          return;
        }
        await useShift.getState().recoverCurrentShift(getDataSource());
      })
      .catch(() => useAuth.getState().lock())
      .finally(() => setOperatorLoaded(true));
  }, [hydrated, dataSource]);

  // 根级守卫：未登录/锁定状态下任何路由（含 twpos:// deep link）一律弹回登录页
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => {
    if (!ready) return;
    const blocked = !token || locked || !currentStaff;
    if (blocked && pathname !== '/login') router.replace('/login');
  }, [ready, token, locked, currentStaff, pathname, router]);

  // 有待同步订单且连接 TradingWEB 时：进前台 3 秒后尝试一次，此后每 60 秒重试
  useEffect(() => {
    if (!ready || dataSource !== 'tradingweb' || !token || locked || !currentStaff) return;
    const snapshot = () => {
      const auth = useAuth.getState();
      const settings = useSettings.getState();
      const pending = usePending.getState();
      const operatorId = getUsableOperatorSessionStaffId();
      if (settings.dataSource !== 'tradingweb' || !auth.token || auth.locked || !auth.currentStaff || !operatorId) return null;
      return {
        identity: [settings.serverUrl, settings.storeId, auth.token, auth.currentStaff.id, operatorId].join('|'),
        canSyncPending: canAutoSyncPending({
          pendingCount: pending.items.length,
          dataSource: settings.dataSource,
          token: auth.token,
          locked: auth.locked,
          staffId: auth.currentStaff.id,
          operatorSessionStaffId: operatorId,
        }),
      };
    };
    const coordinator = createAppLifecycleCoordinator({
      schedule: (run) => {
        let active = true;
        const task = InteractionManager.runAfterInteractions(() => { if (active) void run(); });
        return () => { active = false; task.cancel(); };
      },
      snapshot,
      syncPending: () => usePending.getState().syncAll().then(() => undefined).catch(() => undefined),
      uploadAudit: () => useAudit.getState().uploadUnsynced(getDataSource()).then(() => undefined).catch(() => undefined),
      flushTelemetry: () => flushTelemetry(getDataSource()).then(() => undefined).catch(() => undefined),
    });
    coordinator.start();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') coordinator.foreground();
    });
    const unsubscribePending = usePending.subscribe((state, previous) => {
      if (previous.items.length === 0 && state.items.length > 0) coordinator.foreground();
    });
    return () => {
      subscription.remove();
      unsubscribePending();
      coordinator.stop();
    };
  }, [ready, dataSource, token, locked, currentStaff]);

  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }
  return (
    <>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerTintColor: colors.text,
          headerTitleStyle: { fontWeight: '700' },
          headerStyle: { backgroundColor: colors.card },
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="cart" options={{ title: stackTitles.cart }} />
        <Stack.Screen name="checkout" options={{ title: stackTitles.checkout }} />
        <Stack.Screen name="scanner" options={{ title: stackTitles.scanner, presentation: 'modal' }} />
        <Stack.Screen name="order/[id]" options={{ title: stackTitles.orderDetail }} />
        <Stack.Screen name="product/[id]" options={{ title: stackTitles.productDetail }} />
        <Stack.Screen name="customer/[id]" options={{ title: stackTitles.customerDetail }} />
        <Stack.Screen name="shift" options={{ title: stackTitles.shift }} />
        <Stack.Screen name="reports" options={{ title: stackTitles.reports }} />
        <Stack.Screen name="audit" options={{ title: stackTitles.audit }} />
        <Stack.Screen name="purchasing" options={{ title: stackTitles.purchasing }} />
        <Stack.Screen name="pending" options={{ title: stackTitles.pending }} />
        <Stack.Screen name="settings/index" options={{ title: stackTitles.settings }} />
        <Stack.Screen name="settings/hardware" options={{ title: stackTitles.hardware }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <I18nProvider>
      <RootLayoutContent />
    </I18nProvider>
  );
}
