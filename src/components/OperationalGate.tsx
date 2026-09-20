import React, { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { useStoresHydrated, type PersistedStore } from '@/bootstrap/hydration';
import { markPerformance, measurePerformance } from '@/performance/recorder';
import { colors } from '@/theme';

export function OperationalGate({ stores, children }: {
  stores: readonly PersistedStore[];
  children: React.ReactNode;
}) {
  const ready = useStoresHydrated(stores);

  useEffect(() => {
    if (!ready) return;
    markPerformance('route_operational');
    measurePerformance('route_ready', 'shell_mounted', 'route_operational');
  }, [ready]);

  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }
  return children;
}
