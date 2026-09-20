// 硬件与小票：打印机驱动选择（系统/网口/蓝牙/USB）、纸宽/字符集、测试打印、钱箱、
// 蓝牙设备扫描、驱动可用状态、扫码枪说明

import React, { useState } from 'react';
import { Alert, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { errorMessage } from '@/api';
import { Btn, Card, Field, KV, SectionTitle, Segment, Sheet, st } from '@/components/ui';
import { ensureBlePermissions } from '@/hardware/blePermissions';
import { PrinterManager } from '@/hardware/printer/PrinterManager';
import type { PrinterDriverKind } from '@/hardware/printer/types';
import { colors, font } from '@/theme';
import { useSettings } from '@/stores/settings';

interface FoundDevice { id: string; name: string }

export default function Hardware() {
  const settings = useSettings();
  const p = settings.printer;
  const status = PrinterManager.driverStatus();

  const [testing, setTesting] = useState(false);
  const [scanSheet, setScanSheet] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [devices, setDevices] = useState<FoundDevice[]>([]);

  const scanBle = async () => {
    setDevices([]);
    setScanning(true);
    const perm = await ensureBlePermissions();
    if (!perm.ok) {
      setScanning(false);
      Alert.alert('缺少权限', perm.message ?? '蓝牙权限不足');
      return;
    }
    try {
      const ble = require('react-native-ble-plx');
      const manager = new ble.BleManager();
      const found = new Map<string, FoundDevice>();
      manager.startDeviceScan(null, null, (error: any, device: any) => {
        if (error) {
          setScanning(false);
          Alert.alert('扫描失败', String(error?.message ?? error));
          try { manager.destroy(); } catch {}
          return;
        }
        if (device?.id && device?.name) {
          found.set(device.id, { id: device.id, name: device.name });
          setDevices(Array.from(found.values()));
        }
      });
      setTimeout(() => {
        try { manager.stopDeviceScan(); manager.destroy(); } catch {}
        setScanning(false);
      }, 6000);
    } catch {
      setScanning(false);
      Alert.alert('蓝牙不可用', '需要开发构建（npx expo run:android / run:ios），Expo Go 不含蓝牙原生模块');
    }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 60 }}>
      <SectionTitle text="小票打印机" />
      <Card>
        <Segment<PrinterDriverKind>
          options={[
            { value: 'system', label: '系统' },
            { value: 'escpos-network', label: '网口' },
            { value: 'escpos-bluetooth', label: '蓝牙' },
            { value: 'escpos-usb', label: 'USB' },
          ]}
          value={p.driver}
          onChange={(v) => settings.setPrinter({ driver: v })}
        />

        {p.driver === 'system' && (
          <Text style={{ color: colors.sub, fontSize: font.sm, lineHeight: 20, marginBottom: 6 }}>
            走 iOS AirPrint / Android 打印服务，无需驱动即可用（含 Expo Go）。适合 A4/支持系统打印的小票机。
          </Text>
        )}

        {p.driver === 'escpos-network' && (
          <>
            <Field label="打印机 IP" value={p.host} onChangeText={(t) => settings.setPrinter({ host: t.trim() })} placeholder="192.168.1.100" keyboardType="numeric" />
            <Field label="端口（RAW 打印通常 9100）" value={String(p.port)} onChangeText={(t) => settings.setPrinter({ port: parseInt(t, 10) || 9100 })} keyboardType="number-pad" />
          </>
        )}

        {p.driver === 'escpos-bluetooth' && (
          <>
            <Field label="蓝牙设备 ID" value={p.btDeviceId} onChangeText={(t) => settings.setPrinter({ btDeviceId: t.trim() })} placeholder="点下方按钮扫描选择" />
            <Btn title="🔍 扫描附近蓝牙设备" kind="outline" onPress={() => { setScanSheet(true); scanBle(); }} style={{ marginBottom: 10 }} />
            <Field label="Service UUID（通用 ESC/POS 默认 18F0）" value={p.btServiceUUID} onChangeText={(t) => settings.setPrinter({ btServiceUUID: t.trim() })} />
            <Field label="Characteristic UUID（默认 2AF1）" value={p.btCharacteristicUUID} onChangeText={(t) => settings.setPrinter({ btCharacteristicUUID: t.trim() })} />
          </>
        )}

        {p.driver === 'escpos-usb' && (
          <Text style={{ color: colors.warn, fontSize: font.sm, lineHeight: 20, marginBottom: 6 }}>
            USB 传输层为预留接口（src/hardware/printer/transports/index.ts 的 UsbTransport），接入 Android USB Host 库后实现 open/write/close 即可用，业务层零改动。
          </Text>
        )}

        {p.driver !== 'system' && (
          <>
            <Text style={{ color: colors.sub, fontSize: font.sm, marginBottom: 6, marginTop: 4 }}>纸宽</Text>
            <Segment
              options={[{ value: '32' as const, label: '58mm（32列）' }, { value: '48' as const, label: '80mm（48列）' }]}
              value={String(p.widthCols) as '32' | '48'}
              onChange={(v) => settings.setPrinter({ widthCols: v === '48' ? 48 : 32 })}
            />
            <Text style={{ color: colors.sub, fontSize: font.sm, marginBottom: 6 }}>中文编码</Text>
            <Segment
              options={[{ value: 'gbk' as const, label: 'GBK（多数热敏机）' }, { value: 'utf8' as const, label: 'UTF-8（新机型）' }]}
              value={p.charset}
              onChange={(v) => settings.setPrinter({ charset: v })}
            />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <Text style={{ color: colors.text, fontSize: font.md }}>打印后自动切纸</Text>
              <Switch value={p.autoCut} onValueChange={(v) => settings.setPrinter({ autoCut: v })} />
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <Text style={{ color: colors.text, fontSize: font.md }}>现金结账自动弹钱箱</Text>
              <Switch value={p.openDrawerOnCash} onValueChange={(v) => settings.setPrinter({ openDrawerOnCash: v })} />
            </View>
          </>
        )}

        <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
          <Btn title="🖨 测试打印" style={{ flex: 1 }} loading={testing} onPress={async () => {
            setTesting(true);
            try {
              await PrinterManager.testPrint();
            } catch (e) {
              Alert.alert('测试打印失败', errorMessage(e));
            } finally {
              setTesting(false);
            }
          }} />
          <Btn title="打开钱箱" kind="outline" style={{ flex: 1 }} onPress={async () => {
            try {
              await PrinterManager.openDrawer();
            } catch (e) {
              Alert.alert('无法打开钱箱', errorMessage(e));
            }
          }} />
        </View>
      </Card>

      <SectionTitle text="驱动状态" />
      <Card>
        <KV k="TCP 网口驱动" v={status.tcp.ok ? '可用 ✅' : `不可用（${status.tcp.reason}）`} tone={status.tcp.ok ? 'success' : 'danger'} />
        <KV k="蓝牙 BLE 驱动" v={status.ble.ok ? '可用 ✅' : `不可用（${status.ble.reason}）`} tone={status.ble.ok ? 'success' : 'danger'} />
        <Text style={{ color: colors.sub, fontSize: font.xs, marginTop: 6, lineHeight: 18 }}>
          Expo Go 只能用「系统打印」和扫码功能；网口/蓝牙 ESC/POS 打印需开发构建：npx expo run:android 或 run:ios。
        </Text>
      </Card>

      <SectionTitle text="扫码枪" />
      <Card>
        <Text style={{ color: colors.text, fontSize: font.md, fontWeight: '600', marginBottom: 6 }}>三种接入方式（已内置，即插即用）</Text>
        <Text style={{ color: colors.sub, fontSize: font.sm, lineHeight: 21 }}>
          1. 相机扫码：收银台右上角扫码按钮，无需硬件{'\n'}
          2. HID 键盘模式扫码枪（推荐，通用性最强）：USB OTG 或蓝牙配对后直接对着商品扫，收银台自动加购。要求扫码枪配置「回车后缀」（出厂默认）{'\n'}
          3. BLE 专有协议扫码枪：预留接口 src/hardware/scanner/BleScanner.ts，按厂商 UUID 接入
        </Text>
      </Card>

      {/* 蓝牙扫描结果 */}
      <Sheet visible={scanSheet} onClose={() => setScanSheet(false)} title={scanning ? '扫描中…（6 秒）' : '选择蓝牙打印机'}>
        <ScrollView style={{ maxHeight: 380 }}>
          {devices.map((d) => (
            <Pressable
              key={d.id}
              onPress={() => {
                settings.setPrinter({ btDeviceId: d.id });
                setScanSheet(false);
              }}
              style={({ pressed }) => [st.card, { backgroundColor: pressed ? colors.primarySoft : colors.card }]}
            >
              <Text style={{ fontWeight: '600', color: colors.text }}>{d.name}</Text>
              <Text style={{ color: colors.sub, fontSize: font.xs, marginTop: 2 }}>{d.id}</Text>
            </Pressable>
          ))}
          {devices.length === 0 && (
            <Text style={{ color: colors.sub, textAlign: 'center', padding: 30 }}>
              {scanning ? '正在搜索…' : '未发现设备（确认打印机已开机并处于可发现状态）'}
            </Text>
          )}
        </ScrollView>
      </Sheet>
    </ScrollView>
  );
}
