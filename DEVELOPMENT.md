# TradingWEB POS · 研发演进与设计基线

本文档记录 TradingWEB POS 系统的关键架构决策、硬件抽象设计、离线同步机制以及安全门禁演进过程。

---

## 1. 核心架构与技术选型

### 1.1 前端与移动端技术栈
* **框架**：React Native + Expo SDK 53。
* **路由**：Expo Router（基于文件系统的类型安全导航，支持原生 Deep Link）。
* **状态管理**：Zustand（按领域划分：`auth`、`cart`、`shift`、`settings`），配合 `AsyncStorage` 落实本地持久化。
* **硬件交互**：
  * 扫码：统一通过 `ScannerHub` 总线分发，抹平相机扫码（`expo-camera`）与实体外设（USB/蓝牙 HID）的差异。
  * 打印：自研 `ReceiptDoc` 票据描述模型，分层解耦为“文档格式化 -> 指令转换（ESC/POS 或 Plain Text）-> 物理传输（TCP 9100 / BLE / 系统打印）”。

### 1.2 离线优先与幂等性设计
在门店网络偶发性断网或网络抖动场景下，必须确保“收银不中断、钱账不差错、绝不重扣款”：
* **幂等建单**：每笔本地交易创建时即生成全局唯一的 `client_ref` 幂等键。无论断网重试、后台静默上传或手动重新提交，服务端均依据 `client_ref` 判定是否已落单，杜绝重复建单。
* **离线待同步队列**：未联机交易暂存本地加密队列，当网络恢复监听（NetInfo）触发时，后台按序执行静默同步。
* **双数据源适配**：采用 Adapter 模式（`src/api/adapters/`），支持在无后端网络时一键切换 `mock.ts` 离线演示模式，提供完整业务闭环。

---

## 2. 安全加固基线

1. **凭证隔离**：
   * 采用 `expo-secure-store` 操作移动端操作系统级安全芯片（iOS Keychain 与 Android Keystore），敏感 Token 不进入常规本地存储。
2. **员工 PIN 加密与防爆破**：
   * 采用 `sha256$iterations$salt$hash` 格式，杜绝彩虹表碰撞。
   * 单员工独立计数限速：5 次错误锁定 60 秒，并持久化到存储，防止关进程绕过。
3. **哈希链防篡改审计**：
   * 操作日志引入前置 Hash 指针，校验任何本地非正规纂改或恶意清空。

---

## 3. 测试与质量保证

```bash
# 执行单元测试
npm test

# 执行类型检查
npm run ts-check

# 执行代码规范扫描
npm run lint
```
