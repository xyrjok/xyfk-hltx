-- 1. 文章分类表
CREATE TABLE IF NOT EXISTS article_categories (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    sort INTEGER DEFAULT 0
);
INSERT OR IGNORE INTO article_categories (id, name, sort) VALUES (1, '默认分类', 0);

-- 2. 文章表
CREATE TABLE IF NOT EXISTS articles (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER DEFAULT 1,
    title       TEXT NOT NULL,
    content     TEXT,
    is_notice   INTEGER DEFAULT 0,
    view_count  INTEGER DEFAULT 0,
    created_at  INTEGER,
    updated_at  INTEGER,
    cover_image TEXT,
    active      INTEGER DEFAULT 1,
    seo_description TEXT,
    FOREIGN KEY (category_id) REFERENCES article_categories(id) ON DELETE SET DEFAULT
);

-- 3. 商品分类表
CREATE TABLE IF NOT EXISTS categories (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    name      TEXT NOT NULL,
    sort      INTEGER DEFAULT 0,
    image_url TEXT
);
INSERT OR IGNORE INTO categories (id, name, sort, image_url) VALUES (1, '谷歌美国电话/GoogleVoice /GV靓号AAA', 0, 'https://fengzi.eu.org/image/07f005d6-068f-4328-a90c-dad528e9f52a.webp');

-- 4. 商品表
CREATE TABLE IF NOT EXISTS products (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER DEFAULT 1,
    name        TEXT NOT NULL,
    description TEXT,
    sort        INTEGER DEFAULT 0,
    active      INTEGER DEFAULT 1,
    created_at  INTEGER,
    image_url   TEXT,
    tags        TEXT,
    seo_description TEXT,
    member_price_enabled INTEGER DEFAULT 1,
    -- [v2] 是否允许被外部平台通过 /api/open/v1 调用购买（白名单制，默认关闭）
    api_enabled INTEGER DEFAULT 0
);

INSERT OR IGNORE INTO products (id, category_id, name, description, sort, active, created_at, image_url, tags, seo_description) VALUES (1, 1, '(AAA老号)GoogleVoice /GV靓号', '<p style="line-height: 1;">发货格式有两种：</p>
<ul>
<li style="line-height: 1;">账号---密码---辅邮邮箱</li>
<li>账号---密码---2fa验证</li>
</ul>
<p><span style="color: #e03e2d;">注：质保24小时内首登</span></p>
<p style="line-height: 1;"><strong>2fa登陆验证</strong>：把<strong>2fa部分复制到&nbsp;</strong><span style="color: #0766fd;"><a style="color: #0766fd;" href="https://2fa.run" target="_blank" rel="noopener">https://2fa.run&nbsp;</a></span>网站，获取6位数字动态验证码</p>
<p style="line-height: 1;">刚拿到的号不要立刻进行改密、改辅助、改手机等，每过7天后一次只改其中一个。</p>
<p style="line-height: 1;"><strong>以下行为极易触发系统的自动封锁：</strong></p>
<ol>
<li style="line-height: 1.4;"><strong>高频单向操作：</strong>短时间内发送多条短信或拨打多个电话，尤其是对方没有回复时，会被判定为垃圾邮件/骚扰。</li>
<li style="line-height: 1.4;"><strong>内容重复：</strong>向不同号码发送相同或高度相似的内容（如验证码、推广信息）。</li>
<li style="line-height: 1.4;"><strong>包含链接：</strong>在短信中附带短链接或不明网址。</li>
<li style="line-height: 1.4;"><strong>环境异常：</strong>频繁切换 IP（尤其是使用质量较差的代理/梯子）或多设备同时登录，系统会怀疑账号被盗或用于自动化脚本。</li>
<li style="line-height: 1.4;"><strong>新号活跃度异常：</strong>刚拿到的号立刻进行大量操作，容易被判定为营销号。</li>
</ol>
<p style="line-height: 1;"><span style="color: #e03e2d;"><strong><span style="font-size: 17px;">※ 谷歌账号的辅助邮箱作为确认Gmail身份的重要凭证&nbsp;</span></strong></span></p>
<p style="line-height: 1;">① 输入账号密码后选择&ldquo;<strong>确认您的辅助邮箱</strong>&rdquo;（<strong>英文的也选带邮箱图标的第二个选项</strong>）</p>
<p style="line-height: 1;">② 输入<strong>辅助邮箱</strong>即可完成登录</p>
<p style="line-height: 1.2;"><img style="display: block; margin-left: auto; margin-right: auto;" src="https://fengzi.eu.org/image/76785bd8-8ba9-41a9-b2e4-d4d942756f29.webp" alt="" width="600" height="289" /></p>
<p style="line-height: 1.2;"><img style="display: block; margin-left: auto; margin-right: auto;" src="https://fengzi.eu.org/image/61268e4c-a2f6-4cf3-a62b-8f816e310397.webp" alt="" width="600" height="345" /></p>
<p style="line-height: 1.1;"><span style="color: #e03e2d;"><strong><span style="font-size: 17px;">※ 谷歌账号的使用注意事项：</span></strong></span></p>
<p style="line-height: 1.1;">① 任何互联账号都具有相应的防滥用机制，切记不要同IP同设备 同时大量登录使用，以免被批量停用。</p>
<p style="line-height: 1.1;">② 尽量不要使用免费的IP登录使用，因为很多这种IP已被谷歌拉黑，极有可能要求账号进行手机验证甚至停用。</p>
<p style="line-height: 1.1;">③ 切记不要频换IP或者设备登录使用，会被检测到使用行为异常可能导致停用。</p>
<p style="line-height: 1.1;">④ 不要用于批量发送广告信息，垃圾评论等有可能违法谷歌使用规定的用途。</p>', 0, 1, 1786878379, 'https://fengzi.eu.org/image/07f005d6-068f-4328-a90c-dad528e9f52a.webp', 'b1#da00ff b2#da00ff 自动发货,b1#206be7 b2#206be7 可自选号,老靓号', '提供Google Voice（GV）靓号AAA资源，免税区老号资源丰富，支持自选号码、优质老靓号，稳定耐用，适合长期使用与多种业务需求。');

-- 5. 商品规格表
CREATE TABLE IF NOT EXISTS variants (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id       INTEGER NOT NULL,
    name             TEXT NOT NULL,
    price            REAL NOT NULL,
    stock            INTEGER DEFAULT 0,
    color            TEXT,
    image_url        TEXT,
    wholesale_config TEXT,
    custom_markup    REAL DEFAULT 0,
    sales_count      INTEGER DEFAULT 0,
    auto_delivery    INTEGER DEFAULT 1,
    created_at       INTEGER,
    selection_label  TEXT,
    sort             INTEGER DEFAULT 0,
    active           INTEGER DEFAULT 1,
    random_mode_text TEXT,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);
INSERT OR IGNORE INTO variants (id, product_id, name, price, stock, color, image_url, wholesale_config, custom_markup, sales_count, auto_delivery, created_at, selection_label, sort, active, random_mode_text) VALUES
(1, 1, '测试1', 0.01, 5, NULL, NULL, NULL, 0, 0, 1, 1786878379, NULL, 0, 1, NULL),
(2, 1, '测试2', 0.01, 5, NULL, NULL, NULL, 0, 0, 1, 1786878379, NULL, 0, 1, '默认随机测试2'),
(3, 1, '测试3', 0.01, 3, NULL, NULL, NULL, 0.01, 0, 1, 1786878379, '自选卡密测试3', 0, 1, NULL);

-- 6. 卡密表
CREATE TABLE IF NOT EXISTS cards (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    variant_id INTEGER NOT NULL,
    content    TEXT NOT NULL,
    status     INTEGER DEFAULT 0,
    order_id   TEXT,
    -- [v2] 出货渠道溯源：哪个 API 凭证出的货
    api_ref_id INTEGER,
    created_at INTEGER,
    FOREIGN KEY (variant_id) REFERENCES variants(id) ON DELETE CASCADE
);
INSERT OR IGNORE INTO cards (id, variant_id, content, status, order_id, created_at) VALUES
(1,  1, '账号---密码', 0, NULL, 1786878423),
(2,  1, '账号---密码', 0, NULL, 1786878423),
(3,  1, '账号---密码', 0, NULL, 1786878423),
(4,  1, '账号---密码', 0, NULL, 1786878423),
(5,  1, '账号---密码', 0, NULL, 1786878423),
(6,  2, '账号---密码', 0, NULL, 1786878442),
(7,  2, '账号---密码', 0, NULL, 1786878442),
(8,  2, '账号---密码', 0, NULL, 1786878442),
(9,  2, '账号---密码', 0, NULL, 1786878442),
(10, 2, '账号---密码', 0, NULL, 1786878442),
(11, 3, '账号---密码#[测试3AAA]', 0, NULL, 1786878517),
(12, 3, '账号---密码#[测试3BBB]', 0, NULL, 1786878517),
(13, 3, '账号---密码#[测试3CCC]', 0, NULL, 1786878517);

-- 7. 图片分类表
CREATE TABLE IF NOT EXISTS image_categories (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    sort INTEGER DEFAULT 0
);
INSERT OR IGNORE INTO image_categories (id, name, sort) VALUES (1, '默认分类', 0);

-- 8. 图片表
CREATE TABLE IF NOT EXISTS images (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER DEFAULT 1,
    url         TEXT NOT NULL,
    name        TEXT,
    created_at  INTEGER,
    FOREIGN KEY (category_id) REFERENCES image_categories(id) ON DELETE SET DEFAULT
);

-- 9. 订单表
CREATE TABLE IF NOT EXISTS orders (
    id             TEXT PRIMARY KEY,
    trade_no       TEXT,
    variant_id     INTEGER NOT NULL,
    product_name   TEXT,
    variant_name   TEXT,
    price          REAL,
    quantity       INTEGER DEFAULT 1,
    total_amount   REAL,
    contact        TEXT,
    payment_method TEXT,
    status         INTEGER DEFAULT 0,
    cards_sent     TEXT,
    created_at     INTEGER,
    paid_at        INTEGER,
    query_password TEXT,
    user_id         INTEGER,
    -- [v2] shop=零售 / recharge=会员充值 / api=API采购
    order_type      TEXT DEFAULT 'shop'
);

-- 10. 自定义页面表 (并插入3个不可删除的默认页)
CREATE TABLE IF NOT EXISTS pages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    title      TEXT NOT NULL,
    alias      TEXT UNIQUE NOT NULL,
    content    TEXT,
    seo_description TEXT,
    created_at INTEGER,
    updated_at INTEGER
);
INSERT OR IGNORE INTO pages (title, alias, content, created_at, updated_at) VALUES 
('关于我们', 'about-us', '<p>这是关于我们的说明页面内容，请在后台编辑修改。</p>', strftime('%s','now'), strftime('%s','now')),
('服务条款', 'terms', '<p>这是服务条款的说明页面内容，请在后台编辑修改。</p>', strftime('%s','now'), strftime('%s','now')),
('免责声明', 'disclaimer', '<p>这是免责声明的说明页面内容，请在后台编辑修改。</p>', strftime('%s','now'), strftime('%s','now'));

-- 11. 支付网关表
CREATE TABLE IF NOT EXISTS pay_gateways (
    id     INTEGER PRIMARY KEY AUTOINCREMENT,
    name   TEXT NOT NULL,
    type   TEXT NOT NULL,
    config TEXT NOT NULL,
    active INTEGER DEFAULT 1,
    remark TEXT,
    sort INTEGER DEFAULT 0,
    member_recharge INTEGER DEFAULT 0
);

-- 11.5 支付网关初始数据
INSERT OR IGNORE INTO pay_gateways (id, name, type, config, active, remark, sort) VALUES (1, '支付宝', 'alipay_f2f', '{"icon":"/assets/alipay.webp","app_id":"请填入你的支付宝AppID","private_key":"请填入你的支付宝应用私钥(应用私钥)","alipay_public_key":"请填入你的支付宝公钥"}', 1, '【必填】请在后台-支付网关中填入你自己的支付宝当面付密钥；切勿提交明文密钥到仓库', 0);

-- 12. 系统配置表 (并初始化必填项)
CREATE TABLE IF NOT EXISTS site_config (
    key   TEXT PRIMARY KEY,
    value TEXT
);
INSERT OR IGNORE INTO site_config (key, value) VALUES 
('site_name', '夏雨自动发卡系统'), 
('theme', 'default'),
('site_logo', '/assets/xyrjlogo.webp'),
('site_favicon', '/assets/xyrjico.webp'),
('default_upload_provider', 'custom'),
('show_site_name', '0'),
('show_site_logo', '1'),
('admin_captcha_active', '1'),
('member_discount', '100'),
('member_recharge_limit_per_tx_default', '0'),
('member_recharge_limit_total_default', '0'),
('recharge_max_per_tx', '10000'),
('footer_html', '<div class="footer-links"><a href="/custom?alias=terms" target="_blank">服务条款</a> <a href="/custom?alias=disclaimer" target="_blank">免责声明</a> <a href="/custom?alias=about-us" target="_blank">关于我们</a><p>Copyright @ 2026<a href="/" target="_blank">夏雨自动发卡系统</a>欢迎选购！</p></div>');

-- 13. 会员表
CREATE TABLE IF NOT EXISTS users (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    username            TEXT DEFAULT '',
    password_hash       TEXT NOT NULL,
    password_encrypted  TEXT,
    email               TEXT UNIQUE,
    balance             REAL DEFAULT 0,
    frozen              INTEGER DEFAULT 0,
    member_level        INTEGER DEFAULT 0,
    total_recharge      REAL DEFAULT 0,
    -- [v1] 自助充值限额：单笔/累计，0 = 不限（仅约束会员自助充值，管理员手动加余额不受限）
    recharge_limit_per_tx REAL DEFAULT 0,
    recharge_limit_total  REAL DEFAULT 0,
    -- [v1] 等级来源：auto = 自动升级规则管；manual = 管理员手动设定（优先级最高，自动规则不再改动）
    auto_level          INTEGER DEFAULT 0,
    level_source        TEXT DEFAULT 'auto',
    -- [v1] 累计入金 = 自助充值 + 管理员手动加余额（自动升级规则的判定口径）
    total_incoming      REAL DEFAULT 0,
    created_at          INTEGER,
    updated_at          INTEGER
);

-- 14. 余额变动记录表
CREATE TABLE IF NOT EXISTS balance_transactions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL,
    amount      REAL NOT NULL,
    type        TEXT NOT NULL,
    description TEXT,
    order_id    TEXT,
    created_at  INTEGER,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 16. [v2] API 凭证表（一个会员一把 key）
CREATE TABLE IF NOT EXISTS api_credentials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE,
    api_key TEXT NOT NULL UNIQUE,
    api_secret TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'approved',
    is_active INTEGER NOT NULL DEFAULT 1,
    reject_reason TEXT,
    scopes TEXT DEFAULT '',
    rate_limit_per_min INTEGER DEFAULT 60,
    price_mode TEXT DEFAULT 'member',
    allow_callback INTEGER DEFAULT 1,
    callback_whitelist TEXT,
    last_used_at INTEGER,
    created_at INTEGER,
    updated_at INTEGER
);

-- 17. [v2] 下游订单幂等 + 回调状态
CREATE TABLE IF NOT EXISTS api_order_refs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    credential_id INTEGER NOT NULL,
    order_id TEXT NOT NULL,
    downstream_order_no TEXT,
    trace_id TEXT,
    callback_url TEXT,
    callback_status TEXT DEFAULT 'pending',
    callback_attempts INTEGER DEFAULT 0,
    created_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_aor_cred_downstream ON api_order_refs(credential_id, downstream_order_no);
CREATE INDEX IF NOT EXISTS idx_aor_order_id ON api_order_refs(order_id);

-- 18. [v2] API 调用审计
CREATE TABLE IF NOT EXISTS api_call_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    credential_id INTEGER,
    user_id INTEGER,
    method TEXT,
    path TEXT,
    status_code INTEGER,
    error_code TEXT,
    ip TEXT,
    created_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_acl_user ON api_call_logs(user_id, created_at);

-- 18a. [v3+] 上游连接（采购方适配器）
CREATE TABLE IF NOT EXISTS upstream_connections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    base_url TEXT NOT NULL,
    protocol TEXT DEFAULT 'open-v1',
    api_key TEXT,
    api_secret TEXT,
    enabled INTEGER DEFAULT 1,
    last_sync_at INTEGER,
    created_at INTEGER,
    updated_at INTEGER
);

-- 18b. [v3+] 上游 SKU ↔ 本地规格 映射（sync 建立，purchase 自动补货用）
CREATE TABLE IF NOT EXISTS upstream_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    connection_id INTEGER NOT NULL,
    upstream_product_id TEXT,
    upstream_sku_id TEXT NOT NULL,
    local_product_id INTEGER,
    local_variant_id INTEGER,
    name TEXT,
    price REAL DEFAULT 0,
    stock INTEGER DEFAULT 0,
    created_at INTEGER,
    updated_at INTEGER,
    UNIQUE(connection_id, upstream_sku_id)
);

-- 19. 频率限制表 (独立于 site_config，便于管理和自动清理)
CREATE TABLE IF NOT EXISTS rate_limits (
    key           TEXT PRIMARY KEY,
    count         INTEGER DEFAULT 1,
    first_attempt INTEGER NOT NULL
);
