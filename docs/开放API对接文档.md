# xyfk-hltx 开放 API 对接文档（v3）

本项目同时作为**上游供货商**对外供货，兼容三种协议。所有商品需在「商品管理」里勾选
**「开放 API 销售」**（`products.api_enabled=1`）才会对外可见可购。
另内置**采购方适配器**（dujiao-next / acg-faka / open-v1 三种协议），可直接把另一个本站、dujiao-next
或 acg-faka 实例当上游做代销/补货，即「本项目对接本项目」开箱即用 —— 详见第八章。

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
`app/Interceptor/SharedValidation.php`；端点出参已按 acg-faka 3.1.2 源码逐项对齐
（服务器端 `app/Controller/Shared/Commodity.php` + 客户端 `app/Service/Bind/Shared.php`
+ 字段白名单 `app/Util/SharedPayload.php`）。

### 鉴权（易支付风格 MD5，**POST 表单**，非 JSON）

```
unset(sign) → ksort → 移除空串 → http_build_query(data) + "&key=" + appKey → urldecode → md5
```
每个请求带 `app_id` + `app_key` + `sign`：
- `app_id` = **本站会员 ID**
- `app_key` = 该会员的 **api_secret**（兼作签名密钥，这是 acg-faka 的设计）

响应封套：`{ "code": 200, "msg": "success", "data": {...} }`

### 端点（已按 acg-faka 3.1.2 契约逐项对齐）

商品行字段 = COMMODITY_FIELDS（`id/category_id/name/description/cover/price/user_price/
status/code/sort/delivery_way/draft_status/draft_premium/widget/minimum/maximum/config/stock/tags/...`）；
分类字段 = CATEGORY_FIELDS（`id/name/sort/icon/status/pid`）。

| 端点 | 入参（POST 表单） | data 出参 |
|---|---|---|
| `authentication/connect` | — | `{shopName, balance}` |
| `commodity/items` | — | **分类树** `[{id,name,sort,icon,status,pid, children:[商品行]}]` |
| `commodity/item` | `code`（兼容 `sharedCode`） | 单商品行 + `factory_price`（请求方拿货价；多规格=0，逐规格成本在 `config.category_factory`） |
| `commodity/inventory` | `sharedCode`/`code`, `race` | `{count, delivery_way, draft_status, price, user_price, config, factory_price, is_category}` |
| `commodity/inventoryState` | `shared_code`, `card_id`, `num`, `race` | 充足 `{}`；不足返回 code!=200 + `库存不足` |
| `commodity/trade` | `shared_code`, `contact`, `num`, `card_id`, `race`, `request_no`, `sku` | **`{secret, trade_no, amount}`**，`secret` = 卡密文本 |
| `commodity/query/{tradeNo}` | — | `{secret, widget, status}` |
| `commodity/draftCard` | `code`, `limit`, `page`, `race` | `{list:[{id,draft,draft_premium}], total}` |
| `commodity/draft` | `code`, `card_id` | `{draft_premium}` |
| `commodity/stock` | `code`, `race` | `{stock}` |
| `commodity/valuation` | `code`, `num`, `race`, `card_id` | `{price: 总拿货价, currency_code: "CNY"}` |

要点：
- **`delivery_way`：0 = 卡密库存（自动发卡），1 = 人工**（acg-faka 的语义，勿颠倒）
- `config` 是 **INI 文本**（acg-faka 自研 `Ini` 解析器格式）：多规格商品输出
  `[category]`（race=挂牌价）/ `[shared_mapping]`（race=规格id）/ `[category_factory]`（race=拿货价）三段；
  race key 会清洗掉 `. = [ ]` 换行（INI 语法字符），回传时支持 race key / 原名 / 规格 id 三种写法
- **失败一律 code != 200**（acg-faka 抛 `JSONException` 时 code=0，客户端只看是否 200）；
  **HTTP 恒 200** —— 客户端把 HTTP 404/405 当「老版本上游」探测信号，绝不能回
- `trade` 幂等键 = `request_no`（同凭证重复调用回放已有订单含 `secret`，不重复扣款）；
  预选（`card_id`≠0）时数量强制 1，按指定卡出货
- 卡密文本已剥掉 `#[备注]` 标记

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
- `fixed_member` = 固定会员价：忽略批发档位，单价仅由会员折扣决定、与数量无关（对接平台/下游供货推荐）
- `list` = 挂牌价，不打折

**商品/规格报价字段语义**（`/api/open/v1/*` 与 `/api/v1/upstream/*` 统一口径，
与 dujiao-next 官方供货实现 `toUpstreamProductWithMemberPrice` 一致）：
- `price_amount` = 调用方**实付单价**（已含该会员折扣；买 1 件口径，`fixed_member` 下任意数量同价）
- `original_price` = 挂牌原价
- `member_price` = 会员折扣价（无折扣时不返回）

下游按 `price_amount` 记成本即与实际扣款对账一致。`member` 模式下批量命中批发档时实付可更低；
需要成本恒等就用 `fixed_member`。

---

## 七、卡密安全

- 卡密抢占：`SELECT 候选 → UPDATE ... WHERE status=0 → 回读校验数量`，
  不足则整体释放重试，杜绝并发超卖（D1 无事务，这是唯一可靠做法）
- 余额扣减：条件 `UPDATE ... WHERE balance >= ?` + `meta.changes` 判定
- `cards.api_ref_id` 记录出货的 API 凭证，便于溯源追责
- **卡密一旦发出即不可回收**，API 出货默认不做自动退款

---

## 八、本项目 ↔ 本项目（上游代销 / 一键补货）

本站同时内置「供货商」与「采购方」两侧能力：**A 站直接把 B 站当上游**即可代销、一键补货，
无需任何第三方系统。采购方走的就是**第二章的 dujiao-next 协议**（`/api/v1/upstream/*`），
而本站的供货商侧原生实现了该协议 —— 所以本项目对接本项目是开箱即用的。

```
┌─────────────┐   /api/v1/upstream/*（dujiao-next 协议）   ┌─────────────┐
│  B 站（上游）  │◄───────────────────────────────────────│  A 站（下游）  │
│  供货商角色    │   ping / products / orders / orders/{id}  │  采购方角色    │
└─────────────┘                                        └─────────────┘
   B 站会员 API Key = 供货凭据；该会员余额 = 采购资金池
```

> 采购方客户端支持 `dujiao-next` / `acg-faka` / `open-v1` 三种协议（sync + purchase 全自动）；
> `mcy-shop` 作为上游依赖其第三方货源插件（SharedStock / open-api，无稳定公开契约），请手动维护。
> 站与站之间也可混合：任意一侧换成 dujiao-next / acg-faka 实例同样适用。

三种采购协议的连接配置差异：

| `protocol` | 上游系统 | `api_key` / `api_secret` 含义 | 同步入口 | 采购入口 |
|---|---|---|---|---|
| `dujiao-next`（默认） | dujiao-next、本项目 | 上游会员 API Key / Secret（HMAC-SHA256 签名） | `/api/v1/upstream/products` | `/api/v1/upstream/orders` + 查单取卡 |
| `acg-faka` | acg-faka 3.1.2+ | 上游会员 ID（app_id）/ app_key（MD5 易支付签名） | `/shared/commodity/items` | `/shared/commodity/trade`（直接回卡密） |
| `open-v1` | 本项目 | 上游会员 API Key（Bearer），`api_secret` 留空 | `/api/open/v1/goods/list` | `/api/open/v1/order/create`（直接回卡密） |

### 8.1 上游站（B 站）准备

1. **建一个专用会员**（后台 → 会员管理）：建议单独开「代销商」会员，额度与审计互相隔离
2. **生成 API Key**（后台 → 会员管理 → 该会员 → 生成 API Key）：
   `api_key` / `api_secret` 只在生成时显示一次，立即保存
   - 状态必须 `approved` 且「启用」，否则报 `invalid_api_key`
   - **计价口径建议选 `fixed_member`（固定会员价）**：下游拿货价与数量无关，成本核算恒等
   - `scopes` 留空，或至少含 `catalog:read` + `order:read` + `order:write`
3. **给该会员充值余额**：采购扣的就是这个余额，不足时报 `payment_failed`
4. **商品勾选「开放 API 销售」**（`api_enabled=1`）：不勾的商品对下游完全不可见、不可购
5. （可选）限流/回调白名单按需配置；本流程不用回调，无需动

### 8.2 下游站（A 站）接入（四步）

管理 API 统一鉴权：请求头 `Authorization: Bearer <ADMIN_TOKEN>`（环境变量），JSON 请求体。

**第 1 步：创建上游连接**

```bash
curl -X POST https://a.example.com/api/admin/upstream/connection/save \\
  -H "Authorization: Bearer ***" -H 'Content-Type: application/json' \\
  -d '{
    "name": "B站代销",
    "base_url": "https://b.example.com",
    "protocol": "dujiao-next",
    "api_key": "<B站会员的 api_key>",
    "api_secret": "<B站会员的 api_secret>"
  }'
```

- `protocol` 可省略（默认 `dujiao-next`）；支持 `dujiao-next` / `acg-faka` / `open-v1`（含义见上方协议表）；更新已有连接传 `id`
- ⚠️ **自环防护**：把本站自己的地址配成上游会被直接拒绝（防无限递归下单）；
  内网/回环地址同样拒绝（SSRF 防护）。A→B→A 的环路由链式深度守卫兜底
  （出站带 `X-XYFK-Chain-Depth`，≥ 3 拒单）
- 其他管理接口：`connection/list`（列表）、`connection/delete`（删除）

**第 2 步：同步商品（sync）**

```bash
curl -X POST https://a.example.com/api/admin/upstream/sync \\
  -H "Authorization: Bearer ***" -H 'Content-Type: application/json' \\
  -d '{"connection_id": 1}'        # 不传 connection_id 则同步全部启用的连接
```

返回逐连接汇总：`{connection_id, name, ping_ok, products, skus, created, updated, error}`。

行为说明：

- 先 `ping` 验证凭据，再逐页拉 `/api/v1/upstream/products`（单次上限 20 页 × 100 条）
- **新上游 SKU**：自动建本地商品 + 规格并登记 `upstream_items` 映射；
  商品默认 `api_enabled=0`（不对本地下游客开放），等你调完价再开卖
- **已存在的映射**：只刷新名称/拿货价/库存快照，**不会动你手动调过的本地售价**
- ⚠️ **新建规格的售价 = 你的拿货价**（上游 `price_amount` = 对方会员实付价）——
  **请到「商品管理」加价后再开售**，否则零利润代销

**第 3 步：查看映射（可选）**

```bash
curl "https://a.example.com/api/admin/upstream/mapping/list?connection_id=1&page=1&page_size=50" \\
  -H "Authorization: Bearer ***"
```

返回 `{total, page, page_size, items:[{id, connection_id, upstream_product_id, upstream_sku_id,
local_product_id, local_variant_id, name, price, stock, ...}]}`，采购按 `local_variant_id` 定位。

**第 4 步：补货（purchase）—— 把上游卡密买进本地库存**

```bash
curl -X POST https://a.example.com/api/admin/upstream/purchase \\
  -H "Authorization: Bearer ***" -H 'Content-Type: application/json' \\
  -d '{"connection_id": 1, "variant_id": 123, "qty": 10}'
```

- 流程：向上游下单（自动带 `downstream_order_no` 幂等，防重复采购）→ 查单取卡密 →
  逐条入本地卡密库（未售状态）→ 回写规格库存并推高变更时间（下游增量同步可见新货）
- 数量 1–500/次；**卡密不可回收，入货后不支持自动退货**（同第七章红线）
- 返回 `{upstream_order_no, upstream_status, requested, imported, note}`；
  `imported=0` 说明上游没回卡密内容（如手动发货商品），请到上游查单确认

之后就是正常售卖：本地买家下单 → 自动发卡，库存不足再 `purchase` 补货。
也可以把 `purchase` 接进自己的监控脚本做**低库存自动补货**
（判断依据：`mapping/list` 的库存快照 + 本地未售卡数）。

### 8.3 价格与成本口径（务必理解）

| 概念 | 口径 |
|---|---|
| 上游报价 `price_amount` | 下游 API key 的**实付单价**（含会员折扣；`fixed_member` 下与数量无关） |
| 同步进本地的规格 `price` | = 拿货价（**不是**零售价，请手动加价） |
| `upstream_items.price` | 拿货快照（对账用） |
| 采购扣款 | 扣**上游会员余额**，金额 = 实付价 × 数量 |

### 8.4 常见问题

| 现象 | 原因 / 处理 |
|---|---|
| ping 报 `invalid_api_key` | 上游 key 未 approved / 未启用 / 抄错 |
| ping 报 `user_disabled` | 上游会员被冻结，去上游解冻 |
| sync 报「协议 xxx 暂不支持自动同步」 | 该协议未实现自动同步（如 mcy-shop）；重新 save 时换成 `dujiao-next` / `acg-faka` / `open-v1`，或手动维护商品 |
| 下单报 `payment_failed` | 上游会员余额不足，去上游充值 |
| 下单报 `sku_unavailable` | 上游无货 / 商品未勾「开放 API 销售」/ 规格下架 |
| purchase 报「该本地规格未绑定上游 SKU」 | 该规格不是 sync 建的，先执行 sync |
| 报「不能把本站地址配成上游」 | 自环防护拦截（A 站不能拿 A 站当上游） |
| 报 `chain depth exceeded` | 形成 A→B→A 采购环，链式深度守卫（≥ 3）拦截 |
