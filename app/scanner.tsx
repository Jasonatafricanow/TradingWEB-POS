// 相机扫码（内置来源）：EAN/UPC/Code128/QR 等，结果统一走 ScannerHub 分发

import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import React, { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { Btn } from '@/components/ui';
import { ScannerHub } from '@/hardware/scanner/ScannerHub';
import { colors, font } from '@/theme';

export default function Scanner() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  const handled = useRef(false);

  if (!permission) {
    return <View style={{ flex: 1, backgroundColor: '#000' }} />;
  }
  if (!permission.granted) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: colors.bg }}>
        <Text style={{ fontSize: font.lg, color: colors.text, marginBottom: 16, textAlign: 'center' }}>
          需要相机权限才能扫描商品条码
        </Text>
        <Btn title="授权相机" onPress={requestPermission} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <CameraView
        style={{ flex: 1 }}
        enableTorch={torch}
        barcodeScannerSettings={{
          barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39', 'code93', 'itf14', 'codabar', 'qr'],
        }}
        onBarcodeScanned={({ data }) => {
          if (handled.current || !data) return;
          handled.current = true;
          ScannerHub.emit(String(data), 'camera');
          router.back();
        }}
      />
      <View style={{ position: 'absolute', top: '30%', alignSelf: 'center', width: 260, height: 160, borderWidth: 2, borderColor: '#fff', borderRadius: 12, opacity: 0.8 }} />
      <View style={{ position: 'absolute', bottom: 40, alignSelf: 'center', flexDirection: 'row', gap: 12 }}>
        <Btn title={torch ? '关闭手电' : '打开手电'} kind="dark" onPress={() => setTorch(!torch)} />
        <Btn title="取消" kind="dark" onPress={() => router.back()} />
      </View>
    </View>
  );
}
