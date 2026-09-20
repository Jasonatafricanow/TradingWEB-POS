// 客户：搜索 / 新建 / 设为当前交易客户

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, FlatList, Pressable, RefreshControl, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Customer, errorMessage, getDataSource } from '@/api';
import { Btn, Empty, Field, Sheet, st } from '@/components/ui';
import { colors, font } from '@/theme';
import { LOW_END_LIST_PROPS } from '@/components/listPolicy';
import { createLatestRequestGuard } from '@/services/latestRequest';

export default function Customers() {
  const router = useRouter();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [createSheet, setCreateSheet] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const requestGuard = useRef(createLatestRequestGuard()).current;

  const load = useCallback(async (q: string) => {
    const request = requestGuard.begin();
    setLoading(true);
    try {
      const result = await getDataSource().fetchCustomers(q);
      if (requestGuard.isCurrent(request)) setCustomers(result);
    } catch (e) {
      Alert.alert('加载失败', errorMessage(e));
    } finally {
      if (requestGuard.isCurrent(request)) setLoading(false);
    }
  }, [requestGuard]);

  useFocusEffect(
    useCallback(() => {
      load(query);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
  );

  useEffect(() => {
    const timer = setTimeout(() => load(query), query ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, query]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <View style={{ padding: 14, paddingBottom: 8 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <Text style={{ fontSize: font.xl, fontWeight: '800', color: colors.text }}>客户</Text>
          <Btn title="＋ 新建" size="sm" onPress={() => setCreateSheet(true)} />
        </View>
        <TextInput
          style={st.input}
          placeholder="搜索姓名 / 邮箱 / 电话"
          placeholderTextColor="#9CA3AF"
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
          autoCapitalize="none"
        />
      </View>
      <FlatList
        {...LOW_END_LIST_PROPS}
        data={customers}
        keyExtractor={(c) => String(c.id)}
        contentContainerStyle={{ padding: 14, paddingTop: 4 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => load(query)} />}
        ListEmptyComponent={!loading ? <Empty text="暂无客户" /> : null}
        renderItem={({ item: c }) => (
          <Pressable
            onPress={() =>
              router.push({
                pathname: '/customer/[id]',
                params: { id: String(c.id), name: c.name, email: c.email ?? '', phone: c.phone ?? '' },
              })
            }
            style={({ pressed }) => [st.card, { backgroundColor: pressed ? colors.primarySoft : colors.card }]}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ fontWeight: '700', color: colors.text }}>{c.name}</Text>
              {typeof c.ordersCount === 'number' && (
                <Text style={{ color: colors.sub, fontSize: font.xs }}>{c.ordersCount} 单</Text>
              )}
            </View>
            <Text style={{ color: colors.sub, fontSize: font.xs, marginTop: 4 }}>
              {[c.email, c.phone].filter(Boolean).join(' · ') || '-'}
            </Text>
          </Pressable>
        )}
      />

      <Sheet visible={createSheet} onClose={() => setCreateSheet(false)} title="新建客户">
        <Field label="姓名 *" value={name} onChangeText={setName} placeholder="客户姓名" />
        <Field label="邮箱" value={email} onChangeText={setEmail} keyboardType="email-address" placeholder="选填" />
        <Field label="电话" value={phone} onChangeText={setPhone} keyboardType="numeric" placeholder="选填" />
        <Btn
          title="创建"
          onPress={async () => {
            if (!name.trim()) { Alert.alert('提示', '请填写姓名'); return; }
            try {
              await getDataSource().createCustomer({ name: name.trim(), email: email.trim() || undefined, phone: phone.trim() || undefined });
              setCreateSheet(false);
              setName(''); setEmail(''); setPhone('');
              load(query);
            } catch (e) {
              Alert.alert('创建失败', errorMessage(e));
            }
          }}
        />
      </Sheet>
    </SafeAreaView>
  );
}
