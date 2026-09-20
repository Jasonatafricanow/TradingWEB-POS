import { Ionicons } from '@expo/vector-icons';
import { Redirect, Tabs } from 'expo-router';
import React from 'react';
import { useAuth } from '@/stores/auth';
import { colors } from '@/theme';
import { useI18n } from '@/i18n';
import { getTabTitles } from '@/i18n/mobile-shell';
import { OperationalGate } from '@/components/OperationalGate';
import { useCart } from '@/stores/cart';
import type { PersistedStore } from '@/bootstrap/hydration';

const TAB_OPERATIONAL_STORES = [useCart] as unknown as readonly PersistedStore[];

export default function TabsLayout() {
  const { t } = useI18n();
  const titles = getTabTitles(t);
  const token = useAuth((state) => state.token);
  const locked = useAuth((state) => state.locked);
  const currentStaffId = useAuth((state) => state.currentStaff?.id ?? null);
  if (!token || locked || !currentStaffId) return <Redirect href="/login" />;

  return (
    <OperationalGate stores={TAB_OPERATIONAL_STORES}>
      <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.sub,
        tabBarStyle: { backgroundColor: colors.card },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: titles.index, tabBarIcon: ({ color, size }) => <Ionicons name="calculator" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="orders"
        options={{ title: titles.orders, tabBarIcon: ({ color, size }) => <Ionicons name="receipt" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="products"
        options={{ title: titles.products, tabBarIcon: ({ color, size }) => <Ionicons name="pricetags" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="customers"
        options={{ title: titles.customers, tabBarIcon: ({ color, size }) => <Ionicons name="people" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="more"
        options={{ title: titles.more, tabBarIcon: ({ color, size }) => <Ionicons name="menu" color={color} size={size} /> }}
      />
      </Tabs>
    </OperationalGate>
  );
}
