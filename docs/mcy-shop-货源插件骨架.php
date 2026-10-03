<?php
declare(strict_types=1);

/**
 * mcy-shop「萌次元」货源插件 —— 对接 xyfk-hltx 开放 API
 * ============================================================================
 * mcy-shop 没有固定的线上对接协议，它把「货源」抽象成 PHP 插件：
 *   kernel/Plugin/Const/Plugin.php:  const TYPE_SHIP = 4;      // 货源插件
 *   kernel/Plugin/Handle/ForeignShip.php   拉取外部商品
 *   kernel/Plugin/Handle/Ship.php          发货 / 库存 / 检查
 *
 * 本插件在内部调用 xyfk-hltx 的 /api/open/v1/*（通用协议），鉴权用 Bearer api_key。
 *
 * ⚠️ 联调提示：mcy-shop 的 Sku / Attr / Widget 具体字段以你安装的 mcy-shop 版本为准，
 *    本骨架按 kernel/Plugin/Entity/Item.php 的构造签名编写，落地前请对照实际版本微调。
 * ============================================================================
 */

namespace App\Plugin\XyfkSupply;

use Kernel\Plugin\Abstract\ForeignShip;
use Kernel\Plugin\Abstract\Ship;
use Kernel\Plugin\Entity\Item;

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

    private function toItems(array $goodsList): array
    {
        $items = [];
        foreach ($goodsList as $g) {
            $skus = [];
            foreach (($g['skus'] ?? []) as $s) {
                // Sku 的构造以你安装的 mcy-shop 版本为准
                $skus[] = new \Kernel\Plugin\Entity\Sku(
                    (string)($s['name'] ?? ''),
                    (float)($s['price_amount'] ?? 0),
                    (string)($s['id'] ?? '')
                );
            }
            // 注意：Item 内部会对 uniqueId 做 md5，所以这里传原始 id 即可
            $items[] = new Item(
                (string)($g['id'] ?? ''),
                (string)($g['category_id'] ?? '1'),
                (string)($g['name'] ?? ''),
                (string)($g['description'] ?? ''),
                (string)($g['image_url'] ?? ''),
                $skus
            );
        }
        return $items;
    }

    /** 拉取外部商品列表 */
    public function getItems(): array
    {
        $res = $this->call('GET', '/api/open/v1/goods/list?page_size=100');
        return $this->toItems($res['data']['items'] ?? []);
    }

    /** 拉取单个商品 */
    public function getItem(string $uniqueId, array $options = []): ?Item
    {
        $res = $this->call('GET', '/api/open/v1/goods/detail?id=' . urlencode($uniqueId));
        $g   = $res['data'] ?? null;
        if (!$g) return null;
        $items = $this->toItems([$g]);
        return $items[0] ?? null;
    }
}

class XyfkShip extends Ship
{
    private string $base;
    private string $apiKey;

    /** 实时库存 */
    public function stock(): int|string
    {
        $res  = $this->call('GET', '/api/open/v1/goods/stock?id=' . urlencode((string)$this->item->id ?? '') . '&variant_id=' . urlencode((string)($this->sku->id ?? '')));
        $list = $res['data']['skus'] ?? [];
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

    /** 交付货物：调用下单接口拿卡密，返回文本 */
    public function delivery(): string
    {
        $res = $this->call('POST', '/api/open/v1/order/create', [
            'goods_id'    => (int)($this->item->id ?? 0),
            'variant_id'  => (int)($this->sku->id ?? 0),
            'num'         => 1,
            'out_trade_no' => uniqid('mcy_', true),
        ]);
        $cards = $res['data']['cards'] ?? [];
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

    // 复用 ForeignShip 的 HTTP 调用（实际项目请抽到公共 trait）
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
}
