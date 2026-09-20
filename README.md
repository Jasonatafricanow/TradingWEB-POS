# TradingWEB POS（门店移动收银端）

> 对标 Shopify POS 的全功能跨平台门店移动收银 App，无缝对接 **TradingWEB** 商业中台。

[![React Native](https://img.shields.io/badge/React%20Native-0.79-blue.svg)](https://reactnative.dev/)
[![Expo](https://img.shields.io/badge/Expo-SDK%2053-black.svg)](https://expo.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5%20Strict-blue.svg)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

---

## 📱 项目简介

**TradingWEB POS** 是一套专为零售门店、快闪店与连锁商家打造的现代化收银系统。基于 Expo 与 React Native 构建，与 TradingWEB 共享 React / TypeScript 体系。项目既支持开箱即用的离线演示模式，也能通过标准 RESTful 协议与 TradingWEB 后端深度联动。

### 🌟 核心功能一览（全面对标 Shopify POS）

* 🛒 **智能收银台**：商品快捷网格、模糊搜索、多规格（颜色/尺码等变体）加购、自定义非标商品录入、条码快速加购。
* 📷 **全通道扫码体系**：
  * 内置手机相机扫码。
  * 通用 HID 键盘模式扫码枪（USB OTG / 蓝牙免驱动）。
  * 统一事件总线（`ScannerHub`），扫码即自动匹配商品加购。
* 🏷️ **灵活折扣与促销**：
  * 行级独立折扣 + 整单总折扣（支持百分比与固定金额）。
  * 本地满减活动规则（店长配置，结算自动计算应用）。
  * 订单备注、会员关联与快捷**挂单 / 取单**（多单并发暂存）。
* 💳 **全场景支付与结算**：
  * 支持现金（快捷面额 + 自动计算找零）、银行卡、微信、支付宝及后台自定义记账式支付。
  * **拆分支付（Split Payment）**：单笔交易支持组合多种支付方式混合结算。
  * **全渠道履约（BOPIS）**：门店现提、到店自提、门店发货。
* 🔄 **统一购物车退换货**：
  * 在订单详情中选中退货行项目，自动带入收银台执行换购。
  * 新旧商品差价多退少补，**单笔流程一步闭环完成**。
* 🖨️ **小票打印与电子票据**：
  * 58mm / 80mm ESC/POS 通用热敏小票机（支持网口 IP:9100 与经典蓝牙）。
  * 系统打印兜底（iOS AirPrint / Android 系统打印服务）与应用内小票预览。
  * **电子小票**：生成标准小票文本，一键调用系统原生分享至短信/邮件/社交软件。
  * 订单补打、交接班汇总单与钱箱联动（RJ11 信号驱动弹箱）。
* 📦 **库存与多库位**：
  * 变体实时库存展示、盘点调整、收货入库与报损记录。
  * 多库位管理（前场陈列 / 后仓储备）。
* 👥 **员工管理与交接班**：
  * 员工登录与 **PIN 码快速解锁/切换收银员**。
  * 完备的交接班流程：开班备用金录入、班次中现金存取、应有现金自动核算、盘点差额比对与交班小票打印。
  * 销售报表：今日营业额、净利润概算、客单价、支付方式分布、热销 Top5 与员工业绩。
* 📶 **离线断网收银（Offline-First）**：
  * 断网时下单自动转入「待同步队列」，钱照收、票照打。
  * 联网后后台静默自动重传，全局分配 `client_ref` 幂等键严格杜绝重复扣款建单。
  * 商品与变体数据本地磁盘缓存，冷启动无网依然支持扫码开单。

---

## 🔒 企业级安全设计

1. **安全凭证存储**：
   * 登录 Token 存入 iOS Keychain / Android Keystore（基于 `expo-secure-store`），绝不落入不安全的明文存储。
   * 员工 PIN 采用 **加盐迭代 SHA-256** 哈希算法落盘（每位员工分配独立随机盐），内存与磁盘均不留明文。
2. **PIN 防爆破机制**：
   * 单员工独立计数限速：连续输错 5 次强制锁定 60 秒（计数持久化，重启 App 不清零）。一人输错不影响其他员工正常解锁。
3. **分权审批矩阵（Manager Approvals）**：
   * 折扣、退款、库存调整等高危操作均受店长 PIN 审批门禁保护。
   * 基础收银员进入系统敏感设置（服务器连接、审批规则）必须店长授权。
4. **防篡改操作日志（Activity Log）**：
   * 本地敏感操作日志采用**密码学哈希链**（每条日志包含前一条记录的 Hash）。
   * 任何非法的本地修改、行删除均会在日志审计界面触发红色篡改告警。

---

## 🚀 快速开始

### 运行环境要求
* Node.js >= 18
* npm 或 pnpm
* 手机端安装 **Expo Go** App（或配置好 Android Studio / Xcode 原生环境）

### 1. 安装依赖

```bash
npm ci
```

### 2. 启动开发服务器

```bash
npx expo start
```

* 控制台输出二维码后，使用手机上的 **Expo Go** 扫码即可直接体验。
* 默认内置完整演示模式（内置 10 种商品、测试条码及模拟店员/店长）。

### 3. 构建原生安装包（支持物理硬件驱动）

若需连接真实蓝牙打印机、网口打印机或 USB 扫码枪：

```bash
# Android 构建
npx expo run:android

# iOS 构建（需 macOS + Xcode）
npx expo run:ios
```

---

## 🔗 对接 TradingWEB

1. 在 POS 登录界面点击「连接 TradingWEB」，输入服务器地址及主站账号密码。
2. 后端核心契约请参阅：**[docs/BACKEND_API.md](docs/BACKEND_API.md)**。
3. 打印机与扫码设备选型建议请参阅：**[docs/设备兼容矩阵.md](docs/设备兼容矩阵.md)**。

---

## 📂 目录结构

```
app/                    # Expo Router 页面（登录/收银台/购物车/结账/订单/商品/客户/交接班/设置）
src/
├── api/                # 数据契约与适配层（types / HTTP client / mock / tradingweb）
├── hardware/           # 硬件抽象层
│   ├── scanner/        # 扫码抽象（ScannerHub 总线、相机、HID、BLE）
│   └── printer/        # 打印抽象（ReceiptDoc 票据文档、ESC/POS 驱动、系统打印）
├── stores/             # 状态管理（Zustand + 持久化：auth / cart / shift / settings）
├── components/         # 业务组件与扫码监听器
docs/                   # 技术文档与对接契约
```

---

## 📄 许可证

本项目采用 [MIT License](LICENSE) 授权。
