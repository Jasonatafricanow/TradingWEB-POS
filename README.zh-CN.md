# TradingWEB POS

[English](README.md) | [简体中文](README.zh-CN.md)

为 TradingWEB 提供离线优先的 Expo / React Native 收银客户端。收银员可以先在本地排队保存销售单，同步时用稳定的 `client_ref` 提交。

## 工程细节

- 订单幂等提交，待同步请求使用 HMAC 防篡改。
- 本地 PIN 使用加盐迭代哈希，审计日志形成哈希链。
- 扫码与打印适配器覆盖相机、HID、BLE、TCP 和 ESC/POS。

## 运行与验证

```bash
npm ci
npm start
npm run typecheck
npm test
npm run lint
```

Android 构建及接入条件见[实现说明](docs/IMPLEMENTATION.md)，硬件支持见[设备矩阵](docs/设备兼容矩阵.md)。

## 现场证据

[单店试点验收清单](docs/单店试点验收清单.md)尚未完成。自动化测试和 Android 构建不能代表门店验收通过。演示 APK、断网到联网的录屏、真实设备证据仍待补齐。当前自动同步由启动、返回前台和首次出现待同步订单触发；网络恢复触发重试仍是后续工作。

## 许可

MIT，见 [LICENSE](LICENSE)。
