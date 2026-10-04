# 开放 API 调用示例（PHP / Python / Node.js）

> 适用于 Cloudflare Workers 发卡系统的开放 API（`/api/open/v1/*`）。
> 完整接口定义见同目录 `openapi.yaml`。
>
> **通用约定**
> - 鉴权：`Authorization: Bearer <api_key>`（或 `X-Api-Key: <api_key>`）
> - 成功响应：HTTP 200，`{ "code": 200, "msg": "ok", "data": {...} }`
> - 失败响应：HTTP 状态码 = `code`，`{ "code": <code>, "msg": "<错误说明>", "data": null }`
> - 限流：每个 API Key 默认 60 次/分钟，超限返回 429 并附 `retry_after`
>
> 下面三个示例各自完成同一业务流：**获取商品列表 → 创建订单 → 查询订单**，
> 全部携带 Bearer 头，可直接填入 `BASE` / `API_KEY` 后运行。

---

## 一、PHP 示例（cURL，PHP 7.4+，零依赖）

```php
<?php
// ============================================================
// 发卡系统开放 API 调用示例（PHP / cURL）
// 流程：获取商品列表 -> 创建订单 -> 查询订单
// 运行：php open_api_demo.php
// ============================================================

// ---- 配置 ----
$BASE    = 'https://your-domain.example'; // 站点根地址（不带 /api/open/v1）
$API_KEY = 'sk_your_api_key';             // 会员中心申请的 API Key

/**
 * 统一请求封装：自动带 Bearer 头，返回解码后的关联数组
 * @param string $method  GET / POST
 * @param string $path    以 / 开头的接口路径（含 /api/open/v1 前缀）
 * @param array|null $body POST 时的 JSON 请求体（GET 传 null）
 */
function api_request(string $method, string $path, ?array $body, string $base, string $apiKey): array
{
    $ch = curl_init($base . $path);
    $headers = [
        'Authorization: Bearer ' . $apiKey, // 鉴权：Bearer 头
        'Accept: application/json',
    ];
    $opts = [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 30,
        CURLOPT_HTTPHEADER     => $headers,
        CURLOPT_CUSTOMREQUEST  => $method,
    ];
    if ($body !== null) {
        $json = json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        $headers[] = 'Content-Type: application/json';
        $opts[CURLOPT_HTTPHEADER] = $headers;
        $opts[CURLOPT_POSTFIELDS] = $json;
    }
    curl_setopt_array($ch, $opts);
    $resp = curl_exec($ch);
    if ($resp === false) {
        throw new RuntimeException('请求失败: ' . curl_error($ch));
    }
    $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    $data = json_decode($resp, true);
    if (!is_array($data)) {
        throw new RuntimeException("响应不是合法 JSON (HTTP {$status}): {$resp}");
    }
    // 统一按业务码判断（code === 200 为成功）
    if (($data['code'] ?? 0) !== 200) {
        echo "[业务错误] HTTP {$status} code={$data['code']} msg={$data['msg']}\n";
    }
    return $data;
}

try {
    // ---- 1. 获取商品列表（第 1 页，每页 10 条）----
    $list = api_request('GET', '/api/open/v1/goods/list?page=1&page_size=10', null, $BASE, $API_KEY);
    echo "商品总数: {$list['data']['total']}\n";
    foreach ($list['data']['items'] as $g) {
        echo "  [商品 {$g['id']}] {$g['name']}  最低价 {$g['price_amount']} {$g['currency']}\n";
        foreach ($g['skus'] as $sku) {
            echo "      规格 {$sku['id']} {$sku['name']} 单价 {$sku['price_amount']} 库存 {$sku['stock_quantity']}\n";
        }
    }

    // 取第一个有库存的商品 + 规格用于下单
    $goodsId = null; $variantId = null;
    foreach ($list['data']['items'] as $g) {
        foreach ($g['skus'] as $sku) {
            if ($sku['stock_quantity'] > 0) { $goodsId = $g['id']; $variantId = $sku['id']; break 2; }
        }
    }
    if ($goodsId === null) {
        echo "没有可用库存，结束\n";
        exit(0);
    }

    // ---- 2. 创建订单（out_trade_no 用时间戳生成，保证幂等可重试）----
    $outTradeNo = 'php' . date('YmdHis') . mt_rand(100, 999);
    $order = api_request('POST', '/api/open/v1/order/create', [
        'goods_id'     => $goodsId,
        'variant_id'   => $variantId,
        'num'          => 1,
        'out_trade_no' => $outTradeNo,            // 商户外部单号，重复提交命中幂等
        // 'notify_url' => 'https://your-server.example/notify', // 可选：发货回调地址
        // 'trace_id'   => 'trace-abc-001',                       // 可选：透传链路 ID
    ], $BASE, $API_KEY);
    echo "下单结果: code={$order['code']} status={$order['data']['status']} amount={$order['data']['amount']}\n";
    if (!empty($order['data']['cards'])) {
        echo "卡密:\n";
        foreach ($order['data']['cards'] as $c) { echo "  {$c}\n"; }
    }

    // ---- 3. 查询订单（用外部单号查）----
    $query = api_request('GET', '/api/open/v1/order/query?out_trade_no=' . urlencode($outTradeNo), null, $BASE, $API_KEY);
    $o = $query['data'];
    echo "查单结果: order_id={$o['order_id']} status={$o['status']} amount={$o['amount']} 卡密数=" . count($o['cards']) . "\n";
} catch (Throwable $e) {
    echo "异常: " . $e->getMessage() . "\n";
    exit(1);
}
```

---

## 二、Python 示例（仅标准库，Python 3.7+，零依赖）

```python
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
发卡系统开放 API 调用示例（Python 标准库版）
流程：获取商品列表 -> 创建订单 -> 查询订单
运行：python3 open_api_demo.py
"""

import json
import random
import time
import urllib.error
import urllib.parse
import urllib.request

# ---- 配置 ----
BASE = "https://your-domain.example"   # 站点根地址（不带 /api/open/v1）
API_KEY = "sk_your_api_key"            # 会员中心申请的 API Key


def api_request(method, path, body=None):
    """统一请求封装：自动带 Bearer 头，返回解析后的 dict（统一按 code 判断成败）"""
    url = BASE + path
    headers = {
        "Authorization": "Bearer " + API_KEY,   # 鉴权：Bearer 头
        "Accept": "application/json",
    }
    data = None
    if body is not None:
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        # 业务错误时 HTTP 状态码 = code，错误体同样是统一封套
        payload = json.loads(e.read().decode("utf-8"))
    if payload.get("code") != 200:
        print("[业务错误] code=%s msg=%s" % (payload.get("code"), payload.get("msg")))
    return payload


def main():
    # ---- 1. 获取商品列表（第 1 页，每页 10 条）----
    lst = api_request("GET", "/api/open/v1/goods/list?page=1&page_size=10")
    items = lst["data"]["items"]
    print("商品总数:", lst["data"]["total"])
    for g in items:
        print("  [商品 %s] %s  最低价 %s %s" % (g["id"], g["name"], g["price_amount"], g["currency"]))
        for sku in g["skus"]:
            print("      规格 %s %s 单价 %s 库存 %s" % (sku["id"], sku["name"], sku["price_amount"], sku["stock_quantity"]))

    # 取第一个有库存的商品 + 规格用于下单
    goods_id = variant_id = None
    for g in items:
        for sku in g["skus"]:
            if sku["stock_quantity"] > 0:
                goods_id, variant_id = g["id"], sku["id"]
                break
        if goods_id is not None:
            break
    if goods_id is None:
        print("没有可用库存，结束")
        return

    # ---- 2. 创建订单（out_trade_no 唯一，重复提交命中幂等）----
    out_trade_no = "py%d%03d" % (int(time.time()), random.randint(0, 999))
    order = api_request("POST", "/api/open/v1/order/create", {
        "goods_id": goods_id,
        "variant_id": variant_id,
        "num": 1,
        "out_trade_no": out_trade_no,            # 商户外部单号，重复提交命中幂等
        # "notify_url": "https://your-server.example/notify",  # 可选：发货回调地址
        # "trace_id": "trace-abc-001",                          # 可选：透传链路 ID
    })
    d = order["data"]
    print("下单结果: code=%s status=%s amount=%s" % (order["code"], d["status"], d["amount"]))
    if d.get("cards"):
        print("卡密:")
        for c in d["cards"]:
            print("  " + c)

    # ---- 3. 查询订单（用外部单号查）----
    q = api_request("GET", "/api/open/v1/order/query?out_trade_no=" + urllib.parse.quote(out_trade_no))
    o = q["data"]
    print("查单结果: order_id=%s status=%s amount=%s 卡密数=%d" % (o["order_id"], o["status"], o["amount"], len(o["cards"])))


if __name__ == "__main__":
    main()
```

---

## 三、Node.js 示例（内置 fetch，Node.js 18+，零依赖）

```javascript
// ============================================================
// 发卡系统开放 API 调用示例（Node.js 18+，内置 fetch）
// 流程：获取商品列表 -> 创建订单 -> 查询订单
// 运行：node open_api_demo.js
// ============================================================

// ---- 配置 ----
const BASE = 'https://your-domain.example'; // 站点根地址（不带 /api/open/v1）
const API_KEY = 'sk_your_api_key';          // 会员中心申请的 API Key

/**
 * 统一请求封装：自动带 Bearer 头，返回解析后的对象（统一按 code 判断成败）
 * @param {'GET'|'POST'} method
 * @param {string} path  以 / 开头的接口路径
 * @param {object|null} body POST 时的 JSON 请求体（GET 传 null）
 */
async function apiRequest(method, path, body = null) {
  const headers = {
    Authorization: 'Bearer ' + API_KEY, // 鉴权：Bearer 头
    Accept: 'application/json',
  };
  const opts = { method, headers };
  if (body !== null) {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const resp = await fetch(BASE + path, opts);
  const payload = await resp.json(); // 业务错误体也是统一封套，照样解析
  if (payload.code !== 200) {
    console.log(`[业务错误] HTTP ${resp.status} code=${payload.code} msg=${payload.msg}`);
  }
  return payload;
}

async function main() {
  // ---- 1. 获取商品列表（第 1 页，每页 10 条）----
  const list = await apiRequest('GET', '/api/open/v1/goods/list?page=1&page_size=10');
  const items = list.data.items;
  console.log('商品总数:', list.data.total);
  for (const g of items) {
    console.log(`  [商品 ${g.id}] ${g.name}  最低价 ${g.price_amount} ${g.currency}`);
    for (const sku of g.skus) {
      console.log(`      规格 ${sku.id} ${sku.name} 单价 ${sku.price_amount} 库存 ${sku.stock_quantity}`);
    }
  }

  // 取第一个有库存的商品 + 规格用于下单
  let goodsId = null, variantId = null;
  for (const g of items) {
    for (const sku of g.skus) {
      if (sku.stock_quantity > 0) { goodsId = g.id; variantId = sku.id; break; }
    }
    if (goodsId !== null) break;
  }
  if (goodsId === null) { console.log('没有可用库存，结束'); return; }

  // ---- 2. 创建订单（out_trade_no 唯一，重复提交命中幂等）----
  const outTradeNo = 'js' + Date.now() + Math.floor(Math.random() * 1000);
  const order = await apiRequest('POST', '/api/open/v1/order/create', {
    goods_id: goodsId,
    variant_id: variantId,
    num: 1,
    out_trade_no: outTradeNo,                  // 商户外部单号，重复提交命中幂等
    // notify_url: 'https://your-server.example/notify', // 可选：发货回调地址
    // trace_id: 'trace-abc-001',                          // 可选：透传链路 ID
  });
  console.log(`下单结果: code=${order.code} status=${order.data.status} amount=${order.data.amount}`);
  if (order.data.cards && order.data.cards.length) {
    console.log('卡密:');
    for (const c of order.data.cards) console.log('  ' + c);
  }

  // ---- 3. 查询订单（用外部单号查）----
  const q = await apiRequest('GET', '/api/open/v1/order/query?out_trade_no=' + encodeURIComponent(outTradeNo));
  const o = q.data;
  console.log(`查单结果: order_id=${o.order_id} status=${o.status} amount=${o.amount} 卡密数=${o.cards.length}`);
}

main().catch((e) => { console.error('异常:', e); process.exit(1); });
```

---

## 四、HMAC-SHA256 严格模式签名示例（防重放）

简单模式（只带 Bearer 头）之外，可以启用**严格模式**：额外携带三个头，
服务端会校验签名与时间戳，防止请求被篡改或重放：

| 请求头 | 说明 |
| --- | --- |
| `X-Api-Key` | API Key（严格模式下用此头代替/同时配合 Authorization） |
| `X-Api-Timestamp` | Unix 秒级时间戳，允许偏差 **±60 秒** |
| `X-Api-Signature` | `hex(HMAC-SHA256(api_secret, 签名串))`，小写十六进制 |

### 签名串格式

签名串为 4 行文本，用 `\n`（LF）连接，**行尾不带换行**：

```text
METHOD          # HTTP 方法大写，如 GET / POST
path            # 不含 query string 的 URL 路径，如 /api/open/v1/order/query
timestamp       # 与 X-Api-Timestamp 完全一致的 Unix 秒级时间戳
bodyHash        # 请求体原文的哈希十六进制（小写）
```

服务端（`_worker.js` 的 `hmacSign`）实际校验的第 4 段为 **sha256hex(body)**：

```text
sign_string = "POST\n/api/open/v1/order/create\n1759472700\n<sha256hex(body)>"
```

- `body` 为**请求体原文**：GET / 空 body 按空字符串 `""` 计算，
  `sha256hex("") = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`
- **path 不含 query string**：查单用 `/api/open/v1/order/query`，
  而不是 `/api/open/v1/order/query?out_trade_no=xxx`

### md5 变体签名串（dujiao-next 协议专用）

> ⚠️ 另有一种**同格式但第 4 段为 md5hex(body)** 的签名串（对应代码中的 `hmacMd5Sign` /
> `signCallback`），它属于 **dujiao-next 协议**，不用于 `/api/open/v1/*` 的严格模式：
>
> ```text
> sign_string = "METHOD\npath\n{timestamp}\n{md5hex(body)}"
> # 例："POST\n/api/v1/upstream/callback\n1759472700\n<md5hex(body)>"
> ```
>
> - **path 同样不含 query string**
> - **空 body 的 MD5 为常量 `d41d8cd98f00b204e9800998ecf8427e`**
> - 签名算法仍是 `hex(HMAC-SHA256(api_secret, sign_string))`，小写十六进制
> - 两个使用场景：
>   1. **出站回调**（`notify_url` 发货回调）：固定按 `"POST\n/api/v1/upstream/callback\n{ts}\n{md5hex(body)}"`
>      签名，回调头为 `Dujiao-Next-Api-Key` / `Dujiao-Next-Timestamp` / `Dujiao-Next-Signature`；
>      你方**接收回调**时用 md5 变体 + `api_secret` 验签
>   2. **dujiao-next 上游供货协议入站请求**：dujiao-next 实例把本站当上游供货商时，
>      按同样格式对实际请求 path 签名（`Dujiao-Next-*` 头）

md5 变体的完整签名代码（与严格模式只差第 4 段哈希算法）：

```python
# Python（md5 变体）
import hashlib, hmac

def make_signature_md5_variant(secret, method, path, timestamp, body_str):
    # 第 4 段 = md5hex(body)；空 body 的 md5 = d41d8cd98f00b204e9800998ecf8427e
    body_hash = hashlib.md5(body_str.encode("utf-8")).hexdigest()
    sign_string = "%s\n%s\n%s\n%s" % (method, path, timestamp, body_hash)
    return hmac.new(secret.encode("utf-8"), sign_string.encode("utf-8"), hashlib.sha256).hexdigest()

# 接收回调验签示例（回调固定 method=POST、path=/api/v1/upstream/callback）：
# expect = make_signature_md5_variant(api_secret, "POST", "/api/v1/upstream/callback", ts, raw_body)
# assert expect == headers["Dujiao-Next-Signature"].lower()
```

```php
<?php // PHP（md5 变体）
$bodyHash   = md5($bodyStr); // 空 body 的 md5 = d41d8cd98f00b204e9800998ecf8427e
$signString = $method . "\n" . $path . "\n" . $ts . "\n" . $bodyHash;
$sig        = hash_hmac('sha256', $signString, $secret);
```

```javascript
// Node.js（md5 变体）
const bodyHash = crypto.createHash('md5').update(bodyStr, 'utf8').digest('hex');
const signString = `${method}\n${path}\n${ts}\n${bodyHash}`;
const sig = crypto.createHmac('sha256', secret).update(signString, 'utf8').digest('hex');
```

两种签名都是 HMAC-SHA256，只是被签名串第 4 段的哈希算法不同：
**调用 `/api/open/v1/*` 严格模式 → sha256hex(body)**；**dujiao-next 回调 / 上游协议 → md5hex(body)**。请勿混用。

### Python 完整签名 + 请求示例

```python
# -*- coding: utf-8 -*-
"""HMAC-SHA256 严格模式签名示例：签名 -> 携带三个安全头调用 /api/open/v1/balance"""

import hashlib
import hmac
import json
import time
import urllib.request

BASE = "https://your-domain.example"
API_KEY = "sk_your_api_key"
API_SECRET = "sk_your_api_secret"   # api_secret，仅用于签名，绝不放进 URL


def make_signature(secret, method, path, timestamp, body_str, body_hash):
    """
    构造签名串并计算 HMAC-SHA256。
    sign_string = "METHOD\\npath\\ntimestamp\\nbodyHash"
    - path 不含 query string
    - body_hash = sha256hex(body)（服务端严格模式口径）
      （出站回调 md5 变体则改为 md5hex(body)，空 body 的 md5 = d41d8cd98f00b204e9800998ecf8427e）
    """
    sign_string = "%s\n%s\n%s\n%s" % (method, path, timestamp, body_hash)
    return hmac.new(secret.encode("utf-8"),
                    sign_string.encode("utf-8"),
                    hashlib.sha256).hexdigest()   # 小写十六进制


def signed_request(method, path, body=None):
    """发起严格模式请求：X-Api-Key + X-Api-Timestamp + X-Api-Signature"""
    body_str = "" if body is None else json.dumps(body, ensure_ascii=False, separators=(",", ":"))
    ts = str(int(time.time()))                       # Unix 秒，服务端允许 ±60 秒偏差
    body_hash = hashlib.sha256(body_str.encode("utf-8")).hexdigest()   # sha256hex(body)；空串见下方常量
    signature = make_signature(API_SECRET, method, path, ts, body_str, body_hash)

    req = urllib.request.Request(
        BASE + path,                                  # 注意：签名用 path（无 query），URL 本身可以带 query
        data=body_str.encode("utf-8") if body is not None else None,
        headers={
            "X-Api-Key": API_KEY,                     # 严格模式用 X-Api-Key
            "X-Api-Timestamp": ts,
            "X-Api-Signature": signature,
            "Content-Type": "application/json",
        },
        method=method,
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


# ---- 常量速查 ----
# sha256hex("") = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  ← 严格模式空 body
# md5hex("")    = d41d8cd98f00b204e9800998ecf8427e                                  ← 回调 md5 变体空 body

if __name__ == "__main__":
    # GET 请求 body 为空字符串，path 不含 query string
    print(signed_request("GET", "/api/open/v1/balance"))
```

### PHP 等价签名片段

```php
<?php
// 构造签名串 + HMAC-SHA256（严格模式）
function make_signature(string $secret, string $method, string $path, string $ts, string $bodyStr): string {
    // 第 4 段 = sha256hex(body)；GET/空 body 时 sha256('') =
    // e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
    $bodyHash = hash('sha256', $bodyStr);
    // 出站回调 md5 变体改为：$bodyHash = md5($bodyStr); 空 body 的 md5 = d41d8cd98f00b204e9800998ecf8427e
    $signString = $method . "\n" . $path . "\n" . $ts . "\n" . $bodyHash;
    return hash_hmac('sha256', $signString, $secret); // 小写十六进制
}

// 使用：三个安全头随请求发出（此时可不再带 Authorization 头）
$ts  = (string) time();
$sig = make_signature($API_SECRET, 'GET', '/api/open/v1/balance', $ts, '');
$headers = [
    'X-Api-Key: ' . $API_KEY,
    'X-Api-Timestamp: ' . $ts,
    'X-Api-Signature: ' . $sig,
];
```

### Node.js 等价签名片段

```javascript
const crypto = require('crypto');

// 构造签名串 + HMAC-SHA256（严格模式）
function makeSignature(secret, method, path, ts, bodyStr) {
  // 第 4 段 = sha256hex(body)；GET/空 body 时 sha256('') =
  // e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
  const bodyHash = crypto.createHash('sha256').update(bodyStr, 'utf8').digest('hex');
  // 出站回调 md5 变体改为：crypto.createHash('md5')...，空 body 的 md5 = d41d8cd98f00b204e9800998ecf8427e
  const signString = `${method}\n${path}\n${ts}\n${bodyHash}`;
  return crypto.createHmac('sha256', secret).update(signString, 'utf8').digest('hex'); // 小写十六进制
}

// 使用：三个安全头随请求发出（此时可不再带 Authorization 头）
const ts = String(Math.floor(Date.now() / 1000));
const sig = makeSignature(API_SECRET, 'GET', '/api/open/v1/balance', ts, '');
const headers = {
  'X-Api-Key': API_KEY,
  'X-Api-Timestamp': ts,
  'X-Api-Signature': sig,
};
```

### 签名注意事项

1. **timestamp 必须与签名串里的一致**，且与服务端时间偏差不超过 ±60 秒（超时返回
   `401 时间戳已过期（允许偏差 ±60 秒）`）。
2. **body 必须逐字节一致**：签名用的 `bodyStr` 必须就是实际发送的 HTTP 请求体原文
   （序列化方式不同会导致签名不一致）。
3. **path 不含 query string**：`GET /api/open/v1/order/query?order_id=xxx` 的签名 path 是
   `/api/open/v1/order/query`。
4. 提供了 `X-Api-Timestamp` 或 `X-Api-Signature` 任一头，就必须同时提供两个，
   否则返回 `401 签名校验需要同时提供 X-Api-Timestamp 与 X-Api-Signature`。
5. `X-Api-Signature` 建议小写十六进制（服务端比对前会统一转小写）。
