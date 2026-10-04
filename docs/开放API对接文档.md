# xyfk-hltx 开放 API 对接文档（v3）

本项目同时作为**上游供货商**对外供货，兼容三种协议。所有商品需在「商品管理」里勾选
**「开放 API 销售」**（`products.api_enabled=1`）才会对外可见可购。

---

## 一、通用协议 `/api/open/v1/*`（推荐，mcy-shop 插件也走这个）

### 鉴权（二选一）

**简单模式**
```
Authorization: Bearer <api_key>
```

**严格模式**（防重放）
```
X-Api-Key:      <api_key>
X-Api-Timestamp: <unix 秒>
X-Api-Signature: <hex>
```
```
sign_string = "{method}\n{path}\n{timestamp}\n{sha256hex(body)}"
signature   = hex( HMAC-SHA256( api_secret, sign_string ) )
```
时间戳容差 **±60 秒**。`path` 含 query 时按完整 path 参与签名。

### 端点

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/open/v1/balance` | 余额 / 等级 / 计价口径 |
| GET | `/api/open/v1/goods/list?page=&page_size=&category_id=` | 分页商品 |
| GET | `/api/open/v1/goods/detail?id=` | 商品 + 规格 |
| GET | `/api/open/v1/goods/stock?id=&variant_id=` | 实时库存 |
| POST | `/api/open/v1/order/create` | 下单 |
| GET | `/api/open/v1/order/query?order_id= \| out_trade_no=` | 查单 |
| POST | `/api/open/v1/order/cancel` | 取消（退余额 + 释放卡密） |

### 下单

```jsonc
POST /api/open/v1/order/create
{
  "goods_id": 1,
  "variant_id": 3,
  "num": 2,
  "out_trade_no": "下游订单号（幂等键）",
  "trace_id": "可选",
  "notify_url": "可选，发货后回调"
}
```

响应：
```jsonc
{
  "code": 200, "msg": "ok",
  "data": {
    "order_id": "...", "order_no": "...",
    "status": "delivered",
    "amount": "0.02", "unit_price": "0.01", "quantity": 2,
    "currency": "CNY",
    "fulfillment_type": "auto",
    "cards": ["账号---密码", "账号---密码"]
  }
}
```

**幂等**：相同 `out_trade_no` 重复调用会返回已有订单（`idempotent: true`），**不重复扣款**。

### 错误码

`code` 200 = 成功；400 参数错误 / 401 鉴权失败 / 402 余额不足 / 403 禁用 /
404 不存在 / 409 库存竞争 / 429 限流。

---

## 二、dujiao-next 协议 `/api/v1/upstream/*`

契约 1:1 复刻自 `dujiao-next/internal/upstream/signer.go` 与
`internal/modules/upstreamapi/transport/http/`，**任何 dujiao-next 实例都能直接把本站当上游**。

### 鉴权

```
Dujiao-Next-Api-Key:     <api_key>
Dujiao-Next-Timestamp:   <unix 秒>
Dujiao-Next-Signature:   <hex>
```
```
sign_string = "{METHOD}\n{path}\n{timestamp}\n{md5hex(body)}"
signature   = hex( HMAC-SHA256( api_secret, sign_string ) )
```

**三个极易踩的坑：**
1. `path` **不含 query string**
2. `body` 为空时 `md5("") = d41d8cd98f00b204e9800998ecf8427e`
3. 时间戳容差 **±60 秒**

### 端点

| 方法 | 路径 | 响应形状 |
|---|---|---|
| POST | `/api/v1/upstream/ping` | `{ok, site_name, protocol_version, user_id, balance, currency, member_level}` |
| GET | `/api/v1/upstream/categories` | `{ok, categories}` |
| GET | `/api/v1/upstream/products?page&page_size&updated_after&include_inactive` | `{total, items, includes_inactive}`（**无 ok 字段**） |
| GET | `/api/v1/upstream/products/{id}` | `{ok, product}` |
| POST | `/api/v1/upstream/orders` | `{ok, order_id, order_no, status, amount, currency, error_code, error_message}` |
| GET | `/api/v1/upstream/orders/{id}` | `{order_id, order_no, status, amount, refunded_amount, currency, fulfillment, refund_records}`（**无 ok 字段**） |
| POST | `/api/v1/upstream/orders/{id}/cancel` | `{ok}` |

### ⚠️ 协议特殊约定

**余额不足时返回 HTTP 200 + `ok:false` + `error_code:"payment_failed"`**，
调用方按 `ok` 判断而非 HTTP 状态码。本实现严格遵守。

错误码与上游一致：
`missing_auth_headers` / `invalid_timestamp` / `timestamp_expired` / `invalid_api_key` /
`user_disabled` / `invalid_signature` / `bad_request` / `invalid_callback_url` /
`sku_unavailable` / `product_unavailable` / `product_deleted` / `product_not_found` /
`payment_failed` / `internal_error`

订单状态：`pending_payment` / `paid` / `fulfilling` / `partially_delivered` /
`partially_refunded` / `delivered` / `completed` / `canceled` / `refunded`

`callback_url` 有 **SSRF 防护**：拒绝 http(s) 以外协议、内网/回环地址，
并受 `allow_callback` 与 `callback_whitelist` 约束。

---

## 三、acg-faka 协议 `/shared/*`

契约复刻自 `acg-faka/app/Util/Str.php` 的 `generateSignature` 与
`app/Interceptor/SharedValidation.php`。

### 鉴权（易支付风格 MD5，**POST 表单**，非 JSON）

```
unset(sign) → ksort → 移除空串 → http_build_query(data) + "&key=" + appKey → urldecode → md5
```
每个请求带 `app_id` + `app_key` + `sign`：
- `app_id` = **本站会员 ID**
- `app_key` = 该会员的 **api_secret**（兼作签名密钥，这是 acg-faka 的设计）

响应封套：`{ "code": 200, "msg": "success", "data": {...} }`

### 端点

`/shared/authentication/connect`、`/shared/commodity/{items,item,inventoryState,inventory,trade,draftCard,query/{tradeNo},stock,valuation,draft}`

> **联调提示**：acg-faka 各端点的 `data` 内层字段名请以你的 acg-faka 版本为准
> （它在 3.1.1 → 3.1.2 之间改过 `item`/`stock`/`draft`/`valuation` 的入参出参，
> 并用 `protocol` 字段做代次兼容）。签名算法与鉴权流程是确定的，已按源码复刻。

---

## 四、mcy-shop（萌次元商城）

**mcy-shop 不接协议，接 PHP 插件**（`kernel/Plugin/Const/Plugin.php` 的 `TYPE_SHIP = 4`）。

需实现两个接口：
```php
interface ForeignShip { getItems(): array; getItem(string $uniqueId, array $options = []): ?Item; }
interface Ship { delivery(): string; stock(): int|string; hasEnoughStock(int $quantity = 1): bool; ... }
```

插件骨架见 [`docs/mcy-shop-货源插件骨架.php`](./mcy-shop-货源插件骨架.php)，
内部调用本项目的 `/api/open/v1/*`。

⚠️ mcy-shop 的 `Item::uniqueId` 内部会做 **md5**，且 `versions` 用 md5 做增量比对，
所以必须保证商品 id 稳定，否则会被当成新商品。

---

## 五、自环防护（A 站连 A 站）

**绝不允许把本站地址配成上游**，否则会形成无限递归下单
（下游下单 → 去「上游」采购 → 上游就是自己 → 又触发下游下单 →
余额/库存/Worker 额度全部烧光）。

两层防护：
1. **配置层**：`/api/admin/upstream/connection/save` 会比对本站域名，
   命中即拒绝；同时拒绝内网/回环地址（兼 SSRF 防护）
2. **运行层**：递归深度守卫，`X-XYFK-Chain-Depth` ≥ 3 直接拒绝下单

---

## 六、计价口径

由 API Key 的 `price_mode` 决定：
- `member`（默认）= 会员折扣价，与前台会员价**同口径**，含「与批发价取低者」规则
- `list` = 挂牌价，不打折

---

## 七、卡密安全

- 卡密抢占：`SELECT 候选 → UPDATE ... WHERE status=0 → 回读校验数量`，
  不足则整体释放重试，杜绝并发超卖（D1 无事务，这是唯一可靠做法）
- 余额扣减：条件 `UPDATE ... WHERE balance >= ?` + `meta.changes` 判定
- `cards.api_ref_id` 记录出货的 API 凭证，便于溯源追责
- **卡密一旦发出即不可回收**，API 出货默认不做自动退款
