// 轻量 UI 组件库：POS 大按钮/卡片/输入行/弹层，统一视觉。

import React from 'react';
import {
  ActivityIndicator, Modal, Pressable, StyleSheet, Text, TextInput, View, ViewStyle,
} from 'react-native';
import { colors, font, radius } from '@/theme';
import { useI18n } from '@/i18n';

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[st.card, style]}>{children}</View>;
}

export function Btn({
  title, onPress, kind = 'primary', size = 'md', disabled, loading, style, testID,
}: {
  title: string;
  onPress: () => void;
  kind?: 'primary' | 'outline' | 'ghost' | 'danger' | 'success' | 'dark';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
  testID?: string;
}) {
  const { t } = useI18n();
  const bg =
    kind === 'primary' ? colors.primary
    : kind === 'danger' ? colors.danger
    : kind === 'success' ? colors.success
    : kind === 'dark' ? colors.dark
    : 'transparent';
  const fg = kind === 'outline' ? colors.primary : kind === 'ghost' ? colors.sub : '#fff';
  const pad = size === 'lg' ? 16 : size === 'sm' ? 8 : 12;
  const fs = size === 'lg' ? font.lg : size === 'sm' ? font.sm : font.md;
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={loading ? t('a11y.loading') : title}
      accessibilityState={{ disabled: Boolean(disabled || loading), busy: Boolean(loading) }}
      style={({ pressed }) => [
        {
          backgroundColor: bg,
          borderWidth: kind === 'outline' ? 1 : 0,
          borderColor: colors.primary,
          paddingVertical: pad,
          paddingHorizontal: pad + 4,
          borderRadius: radius.md,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: disabled ? 0.45 : pressed ? 0.8 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text style={{ color: fg, fontSize: fs, fontWeight: '600' }}>{title}</Text>
      )}
    </Pressable>
  );
}

export function Tag({ text, tone = 'default' }: { text: string; tone?: 'default' | 'success' | 'danger' | 'warn' | 'primary' }) {
  const map: Record<string, [string, string]> = {
    default: [colors.border, colors.sub],
    success: [colors.successSoft, colors.success],
    danger: [colors.dangerSoft, colors.danger],
    warn: [colors.warnSoft, colors.warn],
    primary: [colors.primarySoft, colors.primary],
  };
  const [bg, fg] = map[tone];
  return (
    <View style={{ backgroundColor: bg, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, alignSelf: 'flex-start' }}>
      <Text style={{ color: fg, fontSize: font.xs, fontWeight: '600' }}>{text}</Text>
    </View>
  );
}

export function Field({
  label, value, onChangeText, placeholder, keyboardType, secureTextEntry, autoCapitalize, editable, testID,
}: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'numeric' | 'email-address' | 'decimal-pad' | 'number-pad' | 'url';
  secureTextEntry?: boolean;
  autoCapitalize?: 'none' | 'sentences';
  editable?: boolean;
  testID?: string;
}) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={st.fieldLabel}>{label}</Text>
      <TextInput
        testID={testID}
        accessibilityLabel={label}
        style={st.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#9CA3AF"
        keyboardType={keyboardType}
        secureTextEntry={secureTextEntry}
        autoCapitalize={autoCapitalize ?? 'none'}
        autoCorrect={false}
        editable={editable}
      />
    </View>
  );
}

export function KV({ k, v, bold, tone }: { k: string; v: string; bold?: boolean; tone?: 'danger' | 'success' }) {
  const color = tone === 'danger' ? colors.danger : tone === 'success' ? colors.success : colors.text;
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}>
      <Text style={{ color: colors.sub, fontSize: font.md }}>{k}</Text>
      <Text style={{ color, fontSize: font.md, fontWeight: bold ? '700' : '400' }}>{v}</Text>
    </View>
  );
}

export function SectionTitle({ text }: { text: string }) {
  return <Text style={st.sectionTitle}>{text}</Text>;
}

export function Empty({ text }: { text?: string }) {
  const { t } = useI18n();
  return (
    <View style={{ alignItems: 'center', padding: 40 }}>
      <Text style={{ color: colors.sub, fontSize: font.md }}>{text ?? t('common.empty')}</Text>
    </View>
  );
}

/** 底部弹层（Sheet 风格 Modal） */
export function Sheet({
  visible, onClose, title, children,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  const { t } = useI18n();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={st.backdrop} onPress={onClose} />
      <View style={st.sheet}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <Text style={{ fontSize: font.lg, fontWeight: '700', color: colors.text }}>{title}</Text>
          <Pressable
            onPress={onClose}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={t('a11y.close')}
          >
            <Text style={{ color: colors.sub, fontSize: font.lg }}>✕</Text>
          </Pressable>
        </View>
        {children}
      </View>
    </Modal>
  );
}

/** 分段选择器 */
export function Segment<T extends string>({
  options, value, onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={st.segmentWrap}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="radio"
            accessibilityLabel={o.label}
            accessibilityState={{ selected: active }}
            style={[st.segmentItem, active && { backgroundColor: colors.card }]}
          >
            <Text style={{ color: active ? colors.primary : colors.sub, fontWeight: active ? '700' : '400', fontSize: font.sm }}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Stepper({ value, onChange, min = 0 }: { value: number; onChange: (v: number) => void; min?: number }) {
  const { t } = useI18n();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <Pressable
        style={st.stepBtn}
        onPress={() => onChange(Math.max(min, value - 1))}
        accessibilityRole="button"
        accessibilityLabel={t('a11y.decrement')}
      >
        <Text style={st.stepTxt}>−</Text>
      </Pressable>
      <Text style={{ fontSize: font.lg, fontWeight: '700', minWidth: 32, textAlign: 'center', color: colors.text }}>
        {value}
      </Text>
      <Pressable
        style={st.stepBtn}
        onPress={() => onChange(value + 1)}
        accessibilityRole="button"
        accessibilityLabel={t('a11y.increment')}
      >
        <Text style={st.stepTxt}>＋</Text>
      </Pressable>
    </View>
  );
}

export const st = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    marginBottom: 10,
  },
  fieldLabel: { fontSize: font.sm, color: colors.sub, marginBottom: 6 },
  input: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: font.md,
    color: colors.text,
  },
  sectionTitle: { fontSize: font.sm, color: colors.sub, marginTop: 14, marginBottom: 8, fontWeight: '600' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: 16,
    paddingBottom: 32,
    maxHeight: '85%',
  },
  segmentWrap: {
    flexDirection: 'row',
    backgroundColor: colors.border,
    borderRadius: radius.sm,
    padding: 3,
    marginBottom: 12,
  },
  segmentItem: { flex: 1, paddingVertical: 8, borderRadius: radius.sm - 2, alignItems: 'center' },
  stepBtn: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepTxt: { color: colors.primary, fontSize: 18, fontWeight: '700' },
});
