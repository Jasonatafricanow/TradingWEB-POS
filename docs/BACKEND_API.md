# TradingWEB 后端对接契约（POS 端）

本应用**直接对接 TradingWEB**（Next.js API Routes + MySQL/Drizzle）。对接层代码：
`src/api/adapters/tradingweb.ts`（唯一需要关心后端细节的文件）。

> 当前权威后端契约为 TradingWEB `pos-v1` 协议规范，Android adapter 位于移动端 `src/api/adapters/tradingweb.ts`。移动端采用最新接口规范，支持幂等建单、加盐 PIN 验证、条码秒查与库存快速调整。

沿用主站既有约定：

| 约定 | 说明 |
|---|---|
| 认证 | 账号层：`Authorization: Bearer <token>`；当班操作员层：`X-POS-Operator-Session` + `X-POS-Device-ID` |
| 错误 | `{ "error": { "code": "...", "message": "...", "retryable": false, "details": null } }`；仅网络错误和 5xx 可自动重试 |
| 金额 | decimal 字符串（如 `"99.00"`）；POS 内部以"分"运算，出入口自动转换 |
| 变体 | `product_variants`：独立 `price`、`sku`、`option1/2/3`；**下单一律按变体价，快照进 `order_items.unit_price`/`sku`**（与主站 order-service 口径一致） |
| 响应包装 | 兼容 `{ data: ... }` 包装与直接返回两种风格 |

---

## 一、直接复用的主站端点（后端零改动即可先跑）

### 1. `POST /api/auth/login`
请求：`{ "email": "...", "password": "..." }`
响应（兼容以下任一形态）：`{ token, user: { id, name, email, role } }` 或 `{ data: { token, user } }`
> 账号 JWT 不等于当班操作员。Task 5 起 PIN 不从登录响应返回，也没有默认 `1234`；Android 必须另行创建 operator session。

### 2. `GET /api/products?limit=100&search=<q>`
响应：商品数组（或 `{data:[...]}`），每项：
```jsonc
{
  "id": 1, "name": "经典T恤", "price": "99.00",      // 展示/兜底价，可为 null
  "type": "physical",                                  // physical | service | virtual
  "is_active": true, "image": null,
  "sku": null, "barcode": null,                        // 无变体商品的产品级条码（barcode 列见 §三.1）
  "stock": null,
  "delivery_methods": "online,email",                  // 逗号分隔或数组均可
  "variants": [
    { "id": 101, "sku": "TS-BLK-M", "barcode": null, "price": "99.00",
      "option1": "黑", "option2": "M", "option3": null, "stock": 12 }
  ]
}
```

### 3. `GET /api/customers?limit=50&search=<q>` / `POST /api/customers`
POST 请求：`{ name, email|null, phone|null }`。端点不存在（404）时 POS 客户功能自动隐藏数据（返回空列表），不报错。

### 4. 旧 `/api/orders` 读取契约（POS 已停止使用）
订单字段映射（POS 做了宽容解析）：`number|order_number`、`created_at`、`total`、`subtotal`、
`discount_total`、`tax_total`、`refunded_total`、`items[]`（product_id、variant_id、name、sku、
unit_price、quantity、delivery_method、variant_label）、`payments[]`（method、label、amount、reference）、
`customer_name`、`staff_name`、`note`、`source`。

---

## 二、Task 5 `pos-v1` Android API

所有端点都要求 Bearer JWT；除 bootstrap 和创建 operator session 外，业务端点还要求：

```http
X-POS-Operator-Session: <raw token，仅签发时返回一次>
X-POS-Device-ID: <Android installation ID，禁止使用 IMEI/序列号/广告 ID>
```

### 1. `GET /api/admin/pos/bootstrap?store_id=<uuid>`

返回门店、币种、税配置、促销、允许的 payment methods、`pricing_version`、`contract_version: "pos-v1"`、`operator_session_ttl_seconds: 28800` 和 `approval_ttl_seconds: 300`。不得包含 PIN、token hash 或锁定内部字段。

### 2. `POST /api/admin/pos/operator-sessions`

```json
{
  "staff_id": "staff-uuid",
  "store_id": "store-uuid",
  "device_id": "android-installation-uuid",
  "pin": "123456"
}
```

成功返回 HTTP 201，raw token 只出现一次。会话绑定 account/staff/store/device，TTL 8 小时；同一 staff/store/device 的旧活动会话会被吊销。`GET /current` 校验当前会话，`DELETE /current` 注销。

### 3. `POST /api/admin/pos/approvals`

需要有效 operator session。请求 `{ "store_id", "operation", "resource_hash" }`；只有同店 active manager/admin 可签发。token 绑定 operation/resource/store，5 分钟有效且只能原子消费一次。

### 4. `POST /api/admin/pos/checkout`

严格请求体，不接受额外字段：

```json
{
  "idempotency_key": "android-checkout-018f...",
  "store_id": "store-uuid",
  "currency": "USD",
  "staff_id": "staff-uuid",
  "customer_id": null,
  "note": null,
  "fulfillment": { "method": "in_store" },
  "items": [
    {
      "product_id": "product-uuid",
      "variant_id": null,
      "quantity": 2,
      "line_discount": "1.00"
    }
  ],
  "order_discount": "2.00",
  "pricing_preview": {
    "subtotal": "20.00",
    "discount": "3.00",
    "tax": "0.00",
    "total": "17.00"
  },
  "pricing_version": "pos-v1",
  "payments": [
    { "method": "cash", "label": "Cash", "amount": "7.00", "reference": null },
    { "method": "card", "label": "Card", "amount": "10.00", "reference": "TERM-1" }
  ]
}
```

金额必须是两位小数的非负 decimal 字符串，payment amount 必须大于 0，quantity 必须为正整数。`fulfillment.method` 仅允许 `in_store`、`pickup`、`ship`；pickup/ship 的联系人、电话和地址/自提时间按服务端规则必填。

服务端从数据库读取权威商品/变体价，校验 store currency、pricing version、履约、折扣上限和 `sum(payments) === total`。客户端上传的 `pricing_preview` 只用于漂移检测；不一致返回 HTTP 409 `PRICING_CHANGED` 并在 `details` 返回新权威金额，不创建订单。

首次成功返回 HTTP 201 `{ "data": PosOrderDto }`。同 key + 同规范化 SHA-256 请求摘要重放相同 DTO；同 key + 不同摘要返回 409 `IDEMPOTENCY_KEY_REUSED`。订单、明细、每笔支付、库存流水和 timeline 在同一数据库事务内提交。

`PosOrderDto` 的稳定字段包括：`id`、`order_no`、`created_at`、`source: "pos"`、状态字段、`subtotal`、`discount_total`、`tax_total`、`total`、`refunded_total`、`items[]` 和 `payments[]`。

### 5. 员工 POS 配置

管理员通过 `PUT /api/admin/staff/:id` 写入 `pos_enabled: boolean`、`pos_permissions: string[]` 和 write-only `pos_pin`（4–8 位数字）。任何 staff API 都不得返回 `pos_pin`、`pos_pin_hash` 或 PIN 失败/锁定内部字段，只返回 `pos_pin_configured`。

---

## 二-A、旧下单协议（已废弃，仅保留迁移对照）

旧 adapter 曾依次尝试 `POST /api/pos/orders` → `POST /api/orders`。Task 6 必须删除该写入回退并切换到 `/api/admin/pos/checkout`；以下字段只用于识别旧 pending 数据，不是新实现模板。
请求体（两个端点同构）：

```jsonc
{
  "source": "pos",
  "staff_id": 1, "staff_name": "张三",
  "customer_id": null,
  "note": null,
  "currency": "USD",
  "items": [
    {
      "product_id": 1, "variant_id": 101, "quantity": 2,
      "unit_price": "99.00",            // POS 侧快照价；服务端应按 variant.price 复核（主站已有严格校验逻辑）
      "line_discount": "10.00",         // 行级折扣（该行合计减免额，无则 "0.00"）；建议 order_items 加 line_discount decimal
      "sku": "TS-BLK-M", "name": "经典T恤",
      "delivery_method": "in_store"     // in_store / pickup(到店自提) / ship(门店发货) ⚠ 见下方白名单说明
    }
  ],
  "promo_label": "满200减20",           // 命中的本地满减活动文案（无则 null），已计入 discount_total
  "subtotal": "198.00", "discount_total": "0.00", "tax_total": "0.00", "total": "198.00",
  "payments": [
    { "method": "cash", "label": "现金", "amount": "198.00", "reference": null }
    // method 可能为后台自定义值（custom_<ts>）或换货抵扣 exchange_credit；均为记账式，label/reference 原样落库即可
  ]
}
```
响应：完整订单对象（含 id、number、items）最佳；仅回 `{ id }` 也兼容（POS 用本地输入补全小票展示）。

**历史幂等实现（不得继续使用）**：旧请求体带 `client_ref`。旧 TradingWEB
`POST /api/pos/orders` 将其拼成 `payment_id = pos:<staffId>:<clientRef>`，下单前按 `payment_id`
查询并重放已有订单。`orders` 当前没有 `client_ref` 列，也没有对该 `payment_id` 方案建立数据库唯一索引，
因此并发请求仍可能同时通过查询并重复执行；不能把这段逻辑描述成强并发幂等。

Task 4/5 已在分支实现 `pos_idempotency_keys`：数据库唯一索引约束 key，保存 request hash、processing/completed 状态、响应和 order 元数据；V1 checkout 已统一使用该服务。旧 `payment_id` 预查询不再承担并发幂等真相。

**M2 已落地的后端兼容能力：**
1. `delivery_method` 白名单已包含 `in_store`、`pickup`、`ship`；POS 收单端点会按行保存该字段。
2. `orders.source` 已由迁移 `0013_orders_source.sql` 建立，默认 `web`；POS 收单端点写入 `source='pos'`。
3. `buyer_name`、`buyer_phone`、`delivery_date`、`delivery_time_slot`、`shipping_address` 已由 POS 收单端点结构化落库。

Task 12 已在 migration 0032 与 POS 专用端点中补齐分页、客户历史和 pickup 状态机；移动端不再依赖本节旧读取协议。

**换货现状**：Task 8 已改为单次 `exchangeOrder(...)`，TradingWEB 在同一事务完成退货、换货新单、库存、差额支付、换货记录与 timeline；移动端不得恢复先退款再下单的双调用编排。

### 8. Task 12 分页订单与自提履约

- `GET /api/admin/pos/orders?page=1&page_size=50&source=pos|web|all&store_id=&date_from=&date_to=&search=&customer_id=&fulfillment_status=`
- `GET /api/admin/pos/orders/:id`
- `PATCH /api/admin/pos/orders/:id/fulfillment`，请求仅允许 `{ "fulfillment_status": "preparing"|"ready"|"picked_up" }`

分页响应固定为 `{ data: { items, page, page_size, total, has_more } }`，`page_size <= 100`。查询和详情强制绑定 operator session 的 store；请求携带不同 store_id 返回 403。自提仅允许 `unfulfilled → preparing → ready → picked_up`，非法跳转/非自提订单返回 409；ready/picked_up 时间和 order_timeline 与状态更新同事务写入。

### 9. Task 13 服务端区间报表

- `GET /api/admin/pos/reports?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD&source=pos|web|all&store_id=&staff_id=`
- 必须携带有效 account 或 operator session；operator store 是权威作用域，不同 `store_id` 返回 403。
- 日期为门店本地自然日闭区间；当前门店 metadata 使用 `timezone_offset`（`+HH:MM`/`-HH:MM`），缺失或格式错误时明确回退 `+00:00`。
- 响应字段：`store`、`date_from`、`date_to`、`source`、`gross`、`refunded`、`refunds_for_orders_in_period`、`net`、`order_count`、`aov`、`by_payment_method`、`by_staff`、`top_items`、`daily`、`hourly`；所有金额均为 decimal string。
- `refunded` 表示查询区间内实际发生的 completed refunds；`refunds_for_orders_in_period` 表示区间内创建订单截至当前的 completed refunds。两者不可混用。
- `gross - refunded = net`，且 `sum(by_payment_method.net_amount) = net`、`sum(daily.net_amount) = net`。本期退款对应历史订单时，仍按原支付方式和原员工归属分摊；客户端遇到不闭合响应必须拒绝展示。
- 查询不设置人为 `limit`，取消订单不计入销售；SQL 以 `store_id`、`source`、日期条件筛选。真实模式禁止重新拉取订单页做本地聚合。

### 10. Task 14 运行遥测与健康汇总

- `POST /api/admin/pos/telemetry`：operator session + device scoped，单批 1–50 条；允许 `sync_failed`、`print_failed`、`scanner_failed`、`app_error` 四类固定字段。
- `GET /api/admin/pos/telemetry/health?store_id=`：仅 admin/manager；manager 只能读取自己的门店，返回最近 24 小时分类计数、最新同步积压和最近事件时间。
- 遥测 UUID 重试幂等；记录写入既有 `audit_logs`，`entity_type='pos_telemetry'`。客户端队列按 server/store/operator/device 隔离，切换环境不得串传。
- 客户端和服务端都必须脱敏；禁止记录 account/operator token、PIN、密码、邮箱、完整客户地址、长卡号/支付凭证。遥测上传失败不得阻断结账、打印错误返回或 pending 状态机。

---

## 三、历史建议端点（新实现不得据此降级安全边界）

### 1. `GET /api/pos/barcode/:code` — 条码秒查（降级路径：search+本地匹配，慢）
```jsonc
// 命中变体
{ "product": { ...同 /api/products 单个商品 }, "variant": { ...variants 中的一项 } }
// 命中无变体商品: { "product": {...}, "variant": null }
// 未命中: null 或 404
```
> 建议给 `products`/`product_variants` 加 `barcode varchar(64)` 索引列；没有 barcode 列时以 `sku` 匹配即可。

### 2. `POST /api/pos/stock-adjust` — 库存调整（盘点/收货/报损）
请求：`{ product_id, variant_id|null, delta: -2, reason: "盘点", location_id: null }`
（`location_id` 在多库位启用后生效，单库位后端忽略即可）
响应：`{ ok: true }`。缺失时 POS 报错提示（不静默）。

### 3. `GET /api/pos/staff` — 旧员工列表（废弃）

旧方案允许返回明文 `pos_pin` 或回退默认 `1234`，现已被 Task 5 operator session 模型禁止。Task 6 不得调用或仿制该契约；员工 API 只可返回 `pos_pin_configured`，PIN 校验和锁定全部在 TradingWEB 服务端完成。

### 4. `POST /api/orders/:id/refund` — 退款
请求：`{ amount: "50.00", reason: "商品瑕疵", restock: true, items: [{ product_id, variant_id|null, qty }] }`
（`items` 为按行退货明细，换货/行级退货时提供；缺省 = 仅金额退款，restock 语义为整单回补）
响应：更新后的订单对象（含 `refunded_total`、`status`）。POS 也会在响应不含订单时主动重查。

### 5. （可选）`POST /api/pos/shifts` — 交接班上报
POS 的交接班/钱箱目前**纯本地**（AsyncStorage）。需要总部汇总时新增该端点，
把 `src/stores/shift.ts` 的 `closeShift` 产出的 summary POST 上去即可。

### 6. （可选）多库位 — POS 已内置 UI，端点就绪即启用
- `GET /api/pos/locations` → `[{ id, name }]`
- `GET /api/pos/stock/:productId?variant_id=<id>` → `[{ location_id, location_name, stock }]`
- 缺失时 POS 显示"按单库位运行"，`stock-adjust` 不带 location 语义。
- 演示模式内置「门店前场 / 后仓」可完整体验交互。

### 7. （可选）采购单 — POS 已内置 UI（新建/收货入库），端点就绪即启用
- `GET /api/pos/purchase-orders?limit=50` → `[{ id, number, supplier, status: "ordered"|"received", created_at, received_at, location_id, items: [{ product_id, variant_id, name, variant_label, sku, quantity }] }]`
- `POST /api/pos/purchase-orders` 请求同构（无 id/status），响应为创建后的采购单
- `POST /api/pos/purchase-orders/:id/receive` → 服务端置 received 并按行入库（location_id 库位）。请求体 `{ idempotency_key, store_id, approval_token }`；`approval_token` 为 `POST /api/admin/pos/approvals` 签发的 `operation=receive` 一次性审批令牌，服务端必须在收货事务内校验并单次消费（与 refund/exchange 同口径），缺失时返回 403 `APPROVAL_REQUIRED`。
- 缺失时 POS 该区块降级提示；「补货建议」不依赖后端（按最近订单销速本地估算）。

### 8. 已废弃：`GET /api/orders?customer_id=<id>&limit=50`
Task 12 起客户档案必须使用 `/api/admin/pos/orders?...&customer_id=<id>` 的服务端分页；禁止拉取有限订单后本地过滤。

### 9. （可选）`POST /api/pos/audit-logs` — 操作日志上报
POS 的操作日志（折扣/退款/换货/库存/现金/未开班收款，含审批人）目前本地保留最近 500 条。
需要总部审计时新增该端点批量上报 `src/stores/audit.ts` 的 entries 即可。

---

## 四、硬件接口预留（与后端无关，抄送硬件同事）

- **扫码枪**：`src/hardware/scanner/`
  - 已实现：相机扫码（expo-camera）、HID 键盘模式扫码枪（USB OTG / 蓝牙，要求回车后缀）
  - 预留：BLE 专有协议 `BleScanner.ts`（填厂商 Service/Characteristic UUID 即可）
  - 所有来源统一经 `ScannerHub.emit(code, source)` 分发，业务层零感知
- **小票机**：`src/hardware/printer/`
  - `ReceiptDoc`（模板）→ `IPrinterDriver`（ESC/POS 或系统打印）→ `ITransport`（字节通道）
  - 已实现：系统打印（AirPrint/打印服务，Expo Go 可用）、ESC/POS 编码器（GBK/UTF-8、58/80mm、
    切纸、条码、QR、钱箱）、网口 TCP:9100 传输、蓝牙 BLE 传输（默认 18F0/2AF1，可改）
  - 预留：`UsbTransport`（实现 open/write/close 三个方法即接入）
  - 网口/蓝牙打印需开发构建（`npx expo run:android|ios`）；Expo Go 中自动降级并给出提示
