// 操作日志：敏感操作留痕（折扣/退款/换货/库存/现金/系统），对标 Shopify POS activity log。
// 店员查看需店长授权；仅本地保留最近 500 条。

import { useRouter } from 'expo-router';
import React, { useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { getCurrentPosSourceScope, getDataSource } from '@/api';
import { ManagerPinGate } from '@/components/ManagerPinGate';
import { Btn, Empty, Tag } from '@/components/ui';
import { useAudit, AUDIT_META, countPendingAuditUploads } from '@/stores/audit';
import { useAuth } from '@/stores/auth';
import { useSettings } from '@/stores/settings';
import { verifyChain } from '@/utils/auditchain';
import { colors, font, radius } from '@/theme';

type Group = 'all' | 'money' | 'stock' | 'system';
const GROUPS: { value: Group; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'money', label: '资金' },
  { value: 'stock', label: '库存' },
  { value: 'system', label: '系统' },
];

function fmt(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export default function Audit() {
  const router = useRouter();
  const entries = useAudit((s) => s.entries);
  const uploadStatuses = useAudit((s) => s.uploadStatuses);
  const uploadState = useAudit((s) => s.uploadState);
  const dataSource = useSettings((s) => s.dataSource);
  const role = useAuth((s) => s.currentStaff?.role);
  const [approved, setApproved] = useState(role !== 'staff');
  const approvedRef = useRef(role !== 'staff');
  const [group, setGroup] = useState<Group>('all');

  const visibleEntries = useMemo(() => {
    const marker = entries.findIndex((entry) => entry.action === 'log_cleared');
    return marker < 0 ? entries : entries.slice(0, marker + 1);
  }, [entries]);
  const shown = useMemo(
    () => (group === 'all' ? visibleEntries : visibleEntries.filter((e) => AUDIT_META[e.action].group === group)),
    [visibleEntries, group]
  );
  // 防篡改：校验哈希链，异常时在顶部醒目提示（不阻断查看）
  const integrity = useMemo(() => verifyChain(entries), [entries]);
  const pendingUploads = countPendingAuditUploads(entries, uploadStatuses, getCurrentPosSourceScope());

  if (!approved) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <ManagerPinGate
          visible
          actionLabel="查看操作日志"
          onApproved={() => {
            approvedRef.current = true;
            setApproved(true);
          }}
          onClose={() => {
            if (!approvedRef.current) router.back();
          }}
        />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {dataSource === 'tradingweb' && (
        <View style={{ marginHorizontal: 14, marginTop: 12, padding: 10, borderRadius: radius.md, backgroundColor: colors.card }}>
          <Text style={{ color: colors.text, fontWeight: '700' }}>
            审计同步：{uploadState.status === 'uploading' ? '上传中' : pendingUploads > 0 ? `待上传 ${pendingUploads} 条` : '已同步'}
          </Text>
          {uploadState.lastError && (
            <Text style={{ color: uploadState.status === 'conflict' ? colors.danger : colors.sub, marginTop: 4 }}>
              {uploadState.lastError}
            </Text>
          )}
          {pendingUploads > 0 && (
            <Btn
              title="重试上传"
              kind="outline"
              size="sm"
              loading={uploadState.status === 'uploading'}
              style={{ marginTop: 8 }}
              onPress={() => {
                void useAudit.getState().uploadUnsynced(getDataSource()).catch(() => {});
              }}
            />
          )}
        </View>
      )}
      {!integrity.ok && (
        <View
          style={{
            marginHorizontal: 14,
            marginTop: 12,
            padding: 10,
            borderRadius: radius.md,
            backgroundColor: '#FDECEA',
            borderWidth: 1,
            borderColor: colors.danger,
          }}
        >
          <Text style={{ color: colors.danger, fontWeight: '700', fontSize: font.sm }}>⚠ 日志完整性校验未通过</Text>
          <Text style={{ color: colors.danger, fontSize: font.xs, marginTop: 2 }}>
            检测到第 {(integrity.brokenAt ?? 0) + 1} 条起被篡改、删除或重排，请核对并留存证据。
          </Text>
        </View>
      )}
      <View style={{ flexDirection: 'row', gap: 8, padding: 14, paddingBottom: 6 }}>
        {GROUPS.map((g) => (
          <Pressable
            key={g.value}
            onPress={() => setGroup(g.value)}
            style={{
              paddingHorizontal: 14,
              paddingVertical: 7,
              borderRadius: radius.md,
              backgroundColor: group === g.value ? colors.primary : colors.primarySoft,
            }}
          >
            <Text style={{ color: group === g.value ? '#fff' : colors.primary, fontWeight: '600' }}>{g.label}</Text>
          </Pressable>
        ))}
      </View>
      <FlatList
        data={shown}
        keyExtractor={(e) => e.id}
        contentContainerStyle={{ padding: 14, paddingTop: 6 }}
        ListEmptyComponent={<Empty text="暂无记录" />}
        renderItem={({ item: e }) => {
          const meta = AUDIT_META[e.action];
          return (
            <View
              style={{
                backgroundColor: colors.card,
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: colors.border,
                padding: 12,
                marginBottom: 8,
              }}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                  <Tag
                    text={meta.label}
                    tone={meta.group === 'money' ? 'danger' : meta.group === 'stock' ? 'warn' : 'primary'}
                  />
                  <Text style={{ color: colors.text, fontWeight: '600', fontSize: font.sm }}>{e.staff}</Text>
                </View>
                <Text style={{ color: colors.sub, fontSize: font.xs }}>{fmt(e.at)}</Text>
              </View>
              <Text style={{ color: colors.text, fontSize: font.sm, marginTop: 6 }}>{e.detail}</Text>
              {e.approvedBy ? (
                <Text style={{ color: colors.sub, fontSize: font.xs, marginTop: 4 }}>店长审批：{e.approvedBy}</Text>
              ) : null}
            </View>
          );
        }}
      />
    </View>
  );
}
