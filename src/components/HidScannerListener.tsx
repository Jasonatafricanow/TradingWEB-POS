// HID 扫码枪监听组件（通用 USB / 蓝牙键盘模式扫码枪）
// 原理：页面挂一个不可见 TextInput 持焦，扫码枪高速"打字"+回车 => 一次扫码。
// 注意事项（见 README 硬件章节）：
//  - 扫码枪需配置"回车(CR/Enter)后缀"（出厂默认基本都是）
//  - 用户在搜索框等真实输入框打字时自动让位，不抢焦点
//  - 仅在收银台页面启用（settings.hidScannerEnabled 可全局关闭）

import React, { useCallback, useEffect, useRef } from 'react';
import { TextInput } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { HidScanBuffer } from '@/hardware/scanner/HidScanBuffer';
import { ScannerHub } from '@/hardware/scanner/ScannerHub';
import { recordTelemetry } from '@/services/telemetry';

export function HidScannerListener({ enabled }: { enabled: boolean }) {
  const ref = useRef<TextInput>(null);
  const buffer = useRef(new HidScanBuffer()).current;
  const focusedScreen = useRef(false);

  useFocusEffect(
    useCallback(() => {
      focusedScreen.current = true;
      return () => {
        focusedScreen.current = false;
      };
    }, [])
  );

  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => {
      if (!focusedScreen.current) return;
      // 已有其他输入框在使用键盘时让位
      const current = (TextInput as any).State?.currentlyFocusedInput?.();
      const isOurs = ref.current && current && current === (ref.current as any);
      if (current && !isOurs) return;
      if (!ref.current?.isFocused()) ref.current?.focus();
    }, 1200);
    return () => clearInterval(timer);
  }, [enabled]);

  if (!enabled) return null;

  return (
    <TextInput
      ref={ref}
      style={{ position: 'absolute', left: -1000, top: 0, width: 1, height: 1, opacity: 0.01 }}
      onChangeText={(t) => buffer.feed(t)}
      onSubmitEditing={() => {
        try {
          const code = buffer.submit();
          if (code) ScannerHub.emit(code, 'hid');
        } catch (error) {
          void recordTelemetry({ type: 'scanner_failed', source: 'hid', message: error instanceof Error ? error.message : String(error) });
        } finally {
          ref.current?.clear();
        }
      }}
      blurOnSubmit={false}
      autoCorrect={false}
      autoCapitalize="none"
      caretHidden
      showSoftInputOnFocus={false}
      accessible={false}
      importantForAccessibility="no"
    />
  );
}
