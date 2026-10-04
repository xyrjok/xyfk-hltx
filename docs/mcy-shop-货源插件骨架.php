<?php
declare(strict_types=1);

/**
 * mcy-shop「萌次元」货源插件 —— 对接 xyfk-hltx 开放 API（v2，已按 mcy-shop 源码核验）
 * ============================================================================
 * mcy-shop 没有固定的线上对接协议，它把「货源」抽象成 PHP 插件：
 *   kernel/Plugin/Const/Plugin.php:  const TYPE_SHIP = 4;      // 货源插件
 *   kernel/Plugin/Handle/ForeignShip.php   拉取外部商品（getItems / getItem）
 *   kernel/Plugin/Handle/Ship.php          发货 / 库存 / 检查
 *
 * 本插件在内部调用 xyfk-hltx 的 /api/open/v1/*（通用协议），鉴权用 Bearer api_key。
 *
 * 已按 mcy-shop 源码核验的关键签名（勿凭感觉改）：
 *   Item::__construct(uniqueId, category, name, introduce, pictureUrl, skus)  ← 6 参
 *   Sku::__construct(uniqueId, name, pictureUrl, price)                       ← 4 参！
 *   Item/Sku::setOptions(array) → 入库为 plugin_data，之后按需回传：
 *     - 商品级：mcy-shop 同步时以 getItem($repertoryItem->unique_id, $plugin_data) 调回
 *     - SKU 级：Ship::__construct 里解码进 $this->options
 *   Item 构造时会对 uniqueId 做 md5（入库即 md5 值）——md5 不可反解，
 *   所以「上游 goods_id / variant_id」必须靠 options(→plugin_data) 传递，绝不能用
 *   $this->item->id / $this->sku->id（那是 mcy-shop 本地库存表的自增 id）。
 * ============================================================================
 */

namespace App\Plugin\XyfkSupply;

use Kernel\Plugin\Abstract\ForeignShip;
use Kernel\Plugin\Abstract\Ship;
use Kernel\Plugin\Entity\Item;
use Kernel\Plugin\Entity\Sku;

class XyfkForeignShip extends ForeignShip
{
    private string $base;      // 例如 https://faka.example.com
    private string $apiKey;

    public function __construct($plugin, array $config)
    {
        parent::__construct($plugin, $config);
        $this->base   = rtrim((string)($config['base_url'] ?? ''), '/');
        $this->apiKey = (string)($config['api_key'] ?? '');
    }

    /** 带鉴权的 HTTP 调用 */
    private function call(string $method, string $path, array $body = []): ?array
    {
        $ch = curl_init($this->base . $path);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 30,
            CURLOPT_CUSTOMREQUEST  => $method,
            CURLOPT_HTTPHEADER     => [
                'Authorization: Bearer ' . $this->apiKey,
                'Content-Type: application/json',
            ],
        ]);
        if ($body) curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body, JSON_UNESCAPED_UNICODE));
        $raw  = curl_exec($ch);
        $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        if ($raw === false || $code !== 200) return null;
        $json = json_decode((string)$raw, true);
        return is_array($json) ? $json : null;
    }

    /** open-v1 商品 → mcy-shop Item（含 options 映射，入库为 plugin_data） */
    private function makeItem(array $g): Item
    {
        $skus = [];
        foreach (($g['skus'] ?? []) as $s) {
            // Sku 构造签名：__construct(uniqueId, name, pictureUrl, price) —— 4 参，顺序勿动
            // price_amount = 调用方实付单价（已含会员折扣）→ 正好作进货价，与实际扣款一致
            $sku = new Sku(
                (string)($s['id'] ?? ''),
                (string)($s['name'] ?? ''),
                (string)($g['image_url'] ?? ''),
                (float)($s['price_amount'] ?? 0)
            );
            $sku->setOptions([
                'goods_id'   => (string)($g['id'] ?? ''),
                'variant_id' => (string)($s['id'] ?? ''),
            ]);
            $skus[] = $sku;
        }
        // Item 构造签名：__construct(uniqueId, category, name, introduce, pictureUrl, skus) —— 6 参
        // uniqueId 内部会 md5，这里传原始商品 id 即可（同步时 md5(md5 原值) 匹配才能对上）
        $item = new Item(
            (string)($g['id'] ?? ''),
            (string)($g['category_id'] ?? '1'),
            (string)($g['name'] ?? ''),
            (string)($g['description'] ?? ''),
            (string)($g['image_url'] ?? ''),
            $skus
        );
        $item->setOptions(['goods_id' => (string)($g['id'] ?? '')]);
        return $item;
    }

    /** 拉取外部商品列表（自动翻页，goods/list 单页上限 100） */
    public function getItems(): array
    {
        $items = [];
        $page  = 1;
        do {
            $res   = $this->call('GET', '/api/open/v1/goods/list?page=' . $page . '&page_size=100');
            $batch = is_array($res) ? ($res['data']['items'] ?? []) : [];
            foreach ($batch as $g) {
                $items[] = $this->makeItem($g);
            }
            $total = (int)(is_array($res) ? ($res['data']['total'] ?? 0) : 0);
            $page++;
        } while (count($batch) > 0 && count($items) < $total && $page <= 50);
        return $items;
    }

    /**
     * 拉取单个商品。
     * ⚠️ mcy-shop 传入的 $uniqueId 是入库时的 md5（Item 构造内部 md5 所致），
     *    不可反解 —— 上游商品 id 只能从导入时存进 plugin_data 的 options 取。
     */
    public function getItem(string $uniqueId, array $options = []): ?Item
    {
        $gid = (int)($options['goods_id'] ?? 0);
        if (!$gid) {
            return null; // 没有映射就无法定位上游商品，交给 mcy-shop 按失败处理
        }
        $res = $this->call('GET', '/api/open/v1/goods/detail?id=' . $gid);
        $g   = is_array($res) ? ($res['data'] ?? null) : null;
        if (!$g || !isset($g['id'])) return null;
        return $this->makeItem($g);
    }
}

class XyfkShip extends Ship
{
    // 父类构造（kernel/Plugin/Abstract/Ship.php）已经把：
    //   货源配置（base_url / api_key）→ $this->config（PluginConfig->config）
    //   SKU 的 plugin_data           → $this->options（本插件存的 goods_id/variant_id）
    // 全部就位 —— 不要声明未初始化的属性，直接从这两处取。

    private function base(): string
    {
        return rtrim((string)($this->config['base_url'] ?? ''), '/');
    }

    private function apiKey(): string
    {
        return (string)($this->config['api_key'] ?? '');
    }

    private function call(string $method, string $path, array $body = []): ?array
    {
        $ch = curl_init($this->base() . $path);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 30,
            CURLOPT_CUSTOMREQUEST  => $method,
            CURLOPT_HTTPHEADER     => [
                'Authorization: Bearer ' . $this->apiKey(),
                'Content-Type: application/json',
            ],
        ]);
        if ($body) curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body, JSON_UNESCAPED_UNICODE));
        $raw  = curl_exec($ch);
        $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        if ($raw === false || $code !== 200) return null;
        $json = json_decode((string)$raw, true);
        return is_array($json) ? $json : null;
    }

    /** 上游商品/规格 id（来自导入时存进 sku.plugin_data 的映射） */
    private function ids(): array
    {
        return [
            'goods_id'   => (int)($this->options['goods_id'] ?? 0),
            'variant_id' => (int)($this->options['variant_id'] ?? 0),
        ];
    }

    /** 实时库存 */
    public function stock(): int|string
    {
        $ids = $this->ids();
        if (!$ids['goods_id'] || !$ids['variant_id']) return 0;
        $res  = $this->call('GET', '/api/open/v1/goods/stock?id=' . $ids['goods_id'] . '&variant_id=' . $ids['variant_id']);
        $list = is_array($res) ? ($res['data']['skus'] ?? []) : [];
        $total = 0;
        foreach ($list as $s) $total += (int)($s['stock_quantity'] ?? 0);
        return $total;
    }

    /** 库存是否充足 */
    public function hasEnoughStock(int $quantity = 1): bool
    {
        return ((int)$this->stock()) >= $quantity;
    }

    /** 下单前检查 */
    public function inspection(array $map): bool
    {
        return $this->hasEnoughStock((int)($map['quantity'] ?? 1));
    }

    /** 交付货物：按订单数量调用下单接口拿卡密，返回文本 */
    public function delivery(): string
    {
        $ids = $this->ids();
        if (!$ids['goods_id'] || !$ids['variant_id']) return '货源映射缺失，请重新导入该商品';
        $num = max(1, (int)($this->order?->quantity ?? 1));
        $res = $this->call('POST', '/api/open/v1/order/create', [
            'goods_id'     => $ids['goods_id'],
            'variant_id'   => $ids['variant_id'],
            'num'          => $num,
            // 幂等键：同一订单重试不会重复扣款/重复出卡
            'out_trade_no' => 'mcy' . (string)($this->order?->id ?? uniqid('', false)),
        ]);
        $cards = is_array($res) ? ($res['data']['cards'] ?? []) : [];
        return implode("\n", $cards);
    }

    public function isCustomRender(): bool
    {
        return false;
    }

    public function render(): string
    {
        return '';
    }
}
