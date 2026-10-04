/**
 * Cloudflare Worker Faka Backend (最终绝对完整版 - 含全站SEO优化 & 文章系统 & 防乱单 & 卡密管理 & 导出功能)
 * 包含：文章系统(升级版)、自选号码、主图设置、手动发货、商品标签、数据库备份恢复、分类图片接口
 * [新增] 全站社交分享优化(OG标签)：支持首页(后台配置)、商品页、文章页、文章中心自动生成卡片
 * [新增] 限制未支付订单数量、删除未支付订单接口
 * [新增] 卡密管理支持分页、搜索（内容/商品/规格）、全量显示
 * [新增] 卡密导出功能：支持按商品/规格/状态导出并自动分类整理为TXT
 * [新增] 商品导出/导入功能：导出商品+分类+规格(不含卡密)为JSON，可在新部署的系统中一键导入，
 *        缺失的商品分类自动创建并关联商品；卡密仍由【卡密管理】单独导出导入
 * [修复] 修复 D1 数据库不支持 BEGIN TRANSACTION/COMMIT 导致的 500 错误
 * [修复] 文章管理支持保存封面图、浏览量和显示状态
 * [新增] Outlook (Graph API) 原生发信支持
 * [新增] 客户订单发货通知
 * [新增] 后台会员管理支持手动添加会员（邮箱/密码/用户名/初始余额/等级）
 */

// === 工具函数 ===
const jsonRes = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
const errRes = (msg, status = 400) => jsonRes({ error: msg }, status);
const time = () => Math.floor(Date.now() / 1000);
// [订单查询限制] 前台订单查询（游客/会员）仅限最近 30 天
const FRONT_ORDER_QUERY_DAYS = 30;
// [订单查询限制] 会员中心（我的订单/交易记录）仅限最近 90 天（约 3 个月）
const MEMBER_ORDER_QUERY_DAYS = 90;
const uuid = () => crypto.randomUUID().replace(/-/g, '');
const stripCardNote = (s) => s.replace(/#\[.*?\]/g, '').trim();

// === 会员系统工具函数 ===

// 密码哈希 (PBKDF2, 100k iterations) - 新版
async function hashPassword(password, env) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');
    const keyMaterial = await crypto.subtle.importKey(
        'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
    );
    const hashBuffer = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
        keyMaterial, 256
    );
    const hashHex = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
    return `pbkdf2$${saltHex}$${hashHex}`;
}

// 验证密码 (兼容旧 SHA-256 和新 PBKDF2)
async function verifyPassword(password, storedHash, env) {
    if (storedHash.startsWith('pbkdf2$')) {
        // PBKDF2 格式: pbkdf2$salt$hash
        const parts = storedHash.split('$');
        const salt = new Uint8Array(parts[1].match(/.{1,2}/g).map(b => parseInt(b, 16)));
        const expectedHash = parts[2];
        const keyMaterial = await crypto.subtle.importKey(
            'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
        );
        const hashBuffer = await crypto.subtle.deriveBits(
            { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
            keyMaterial, 256
        );
        const hashHex = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
        return hashHex === expectedHash;
    } else {
        // 旧 SHA-256 格式 (兼容)
        const salt = env.ADMIN_TOKEN || 'default_salt';
        const msgBuffer = new TextEncoder().encode(salt + ':' + password);
        const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
        const hashHex = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
        return hashHex === storedHash;
    }
}

// 判断是否需要升级哈希 (旧格式 → 新格式)
function needsHashUpgrade(storedHash) {
    return !storedHash.startsWith('pbkdf2$');
}

// 密码加密存储 (AES-GCM, 密钥来自 ADMIN_TOKEN, 仅管理员可解密)
async function encryptPassword(password, env) {
    const rawKey = new TextEncoder().encode(env.ADMIN_TOKEN);
    const keyBytes = new Uint8Array(32);
    keyBytes.set(rawKey.slice(0, 32));
    const keyMaterial = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, keyMaterial, new TextEncoder().encode(password));
    const ivHex = Array.from(iv).map(b => b.toString(16).padStart(2, '0')).join('');
    const ctHex = Array.from(new Uint8Array(encrypted)).map(b => b.toString(16).padStart(2, '0')).join('');
    return `${ivHex}:${ctHex}`;
}

async function decryptPassword(encryptedStr, env) {
    try {
        const [ivHex, ctHex] = encryptedStr.split(':');
        if (!ivHex || !ctHex) return null;
        const iv = new Uint8Array(ivHex.match(/.{1,2}/g).map(b => parseInt(b, 16)));
        const ct = new Uint8Array(ctHex.match(/.{1,2}/g).map(b => parseInt(b, 16)));
        const rawKey = new TextEncoder().encode(env.ADMIN_TOKEN);
        const keyBytes = new Uint8Array(32);
        keyBytes.set(rawKey.slice(0, 32));
        const keyMaterial = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['decrypt']);
        const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, keyMaterial, ct);
        return new TextDecoder().decode(decrypted);
    } catch(e) { return null; }
}

// 生成会员 Token (userId.expiry.hmacSignature)
async function generateToken(userId, env) {
    const expiry = Math.floor(Date.now() / 1000) + 7 * 24 * 3600; // 7天有效期
    const payload = `${userId}.${expiry}`;
    const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(env.ADMIN_TOKEN + '_member_secret'),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );
    const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
    const sigHex = Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, '0')).join('');
    return `${payload}.${sigHex}`;
}

// 验证会员 Token
async function verifyToken(token, env) {
    if (!token) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [userId, expiry, sig] = parts;
    if (parseInt(expiry) < Math.floor(Date.now() / 1000)) return null; // 过期
    const payload = `${userId}.${expiry}`;
    const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(env.ADMIN_TOKEN + '_member_secret'),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['verify']
    );
    const sigBytes = new Uint8Array(sig.match(/.{1,2}/g).map(b => parseInt(b, 16)));
    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(payload));
    return valid ? parseInt(userId) : null;
}

// 会员鉴权中间件
async function memberAuth(request, env, db) {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
    const token = authHeader.substring(7);
    const userId = await verifyToken(token, env);
    if (!userId) return null;
    const user = await db.prepare('SELECT id, username, email, balance, frozen, member_level, auto_level, level_source, recharge_limit_per_tx, recharge_limit_total, total_recharge, total_incoming, created_at, updated_at FROM users WHERE id=?').bind(userId).first();
    if (!user) return null;
    if (user.frozen === 1) return null;
    return user;
}

// 简单的北京时间格式化工具 (UTC+8)
const formatTime = (ts) => {
    if (!ts) return '';
    // 补时差 +8小时 (8 * 3600 * 1000毫秒)
    const d = new Date(ts * 1000 + 28800000);
    return d.toISOString().replace('T', ' ').substring(0, 19);
};

// [新增] 简单的邮箱格式校验
// [安全加固·H1修复] 白名单字符集：禁止引号/尖括号/反引号等进入后台 HTML/JS 上下文
const isEmail = (contact) => {
    const emailRegex = /^[A-Za-z0-9._%+\-\u4e00-\u9fa5]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/;
    return emailRegex.test(contact);
};

// === [安全加固·M4修复] 图形验证码：服务端存储答案 + 一次性令牌 ===
// 旧方案把验证码答案明文写在返回的 SVG 里、hash 也随响应下发，脚本可直接读取答案，形同虚设。
// 新方案：答案只保存在服务端(D1 captcha_store)，响应中的 hash 字段改为一次性校验令牌，前端无需任何改动。
const CAPTCHA_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

async function sha256Hex(str) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function ensureCaptchaTable(db) {
    try {
        await db.prepare('CREATE TABLE IF NOT EXISTS captcha_store (token TEXT PRIMARY KEY, answer_hash TEXT NOT NULL, expire INTEGER NOT NULL)').run();
        await db.prepare('CREATE INDEX IF NOT EXISTS idx_captcha_expire ON captcha_store(expire)').run();
    } catch(e) {}
}

async function createCaptcha(db) {
    await ensureCaptchaTable(db);
    const rand = crypto.getRandomValues(new Uint8Array(4)); // 加密安全随机源
    let text = '';
    for (let i = 0; i < 4; i++) text += CAPTCHA_CHARS[rand[i] % CAPTCHA_CHARS.length];
    const expireTime = time() + 180;
    const token = uuid(); // 一次性校验令牌（不含任何答案信息）
    try { await db.prepare('DELETE FROM captcha_store WHERE expire < ?').bind(time()).run(); } catch(e) {} // 顺手清理过期记录
    await db.prepare('INSERT INTO captcha_store (token, answer_hash, expire) VALUES (?, ?, ?)')
        .bind(token, await sha256Hex(text.toLowerCase() + '_captcha_v2'), expireTime).run();
    const svg = `<svg width="120" height="42" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#f4f6f8"/><text x="50%" y="50%" font-size="24" text-anchor="middle" dominant-baseline="central" font-family="monospace" font-weight="bold" fill="#409EFF" letter-spacing="4">${text}</text></svg>`;
    // 兼容旧前端契约：hash 字段现为一次性令牌
    return { svg, hash: token, expire: expireTime };
}

async function verifyCaptcha(db, text, token, expire) {
    if (!text || !token) return false;
    const expireTs = parseInt(expire);
    if (!Number.isFinite(expireTs) || time() > expireTs) return false;
    await ensureCaptchaTable(db);
    const row = await db.prepare('SELECT answer_hash, expire FROM captcha_store WHERE token=?').bind(token).first();
    if (!row) return false;
    // 一次性使用：无论对错都立即销毁，防止同一验证码被反复提交
    try { await db.prepare('DELETE FROM captcha_store WHERE token=?').bind(token).run(); } catch(e) {}
    if (row.expire < time()) return false;
    return (await sha256Hex(String(text).toLowerCase() + '_captcha_v2')) === row.answer_hash;
}

// [安全加固] 获取客户端真实IP
function getClientIP(request) {
    return request.headers.get('cf-connecting-ip') 
        || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
        || 'unknown';
}

// [安全加固] URL协议安全校验（拒绝 javascript:, data: 等危险协议）
function isSafeUrl(url) {
    if (!url || typeof url !== 'string') return false;
    const trimmed = url.trim().toLowerCase();
    if (!trimmed.startsWith('https://') && !trimmed.startsWith('http://')) return false;
    if (/^(javascript|data|vbscript|file|about|mhtml):/i.test(trimmed)) return false;
    return true;
}

// [安全加固] 图片URL格式校验（允许相对路径和合法HTTP URL）
function isValidImageUrl(url) {
    if (!url || typeof url !== 'string') return false;
    const trimmed = url.trim();
    if (trimmed.startsWith('/')) return true;
    return isSafeUrl(trimmed);
}

// === 支付宝签名与验签核心 (Web Crypto API) ===

/**
 * [签名] 对参数进行 RSA2 签名
 */
async function signAlipay(params, privateKeyPem) {
    // 1. 排序并拼接参数
    const sortedParams = Object.keys(params)
        .filter(k => k !== 'sign' && params[k] !== undefined && params[k] !== null && params[k] !== '')
        .sort()
        .map(k => `${k}=${params[k]}`) 
        .join('&');

    // 2. 导入私钥
    let pemContents = privateKeyPem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s+|\n/g, '');
    let binaryDer = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));
    const key = await crypto.subtle.importKey(
        "pkcs8",
        binaryDer.buffer,
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["sign"]
    );

    // 3. 签名
    const signature = await crypto.subtle.sign(
        "RSASSA-PKCS1-v1_5",
        key,
        new TextEncoder().encode(sortedParams)
    );

    // 4. Base64 编码
    return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

/**
 * [验签] 验证支付宝异步通知
 */
async function verifyAlipaySignature(params, alipayPublicKeyPem) {
    try {
        const sign = params.sign;
        if (!sign) return false;

        // 1. 排序并拼接参数 (不包含 sign 和 sign_type)
        const sortedParams = Object.keys(params)
            .filter(k => k !== 'sign' && k !== 'sign_type' && params[k] !== undefined && params[k] !== null && params[k] !== '')
            .sort()
            .map(k => `${k}=${params[k]}`)
            .join('&');
        
        // 2. 导入支付宝公钥
        let pemContents = alipayPublicKeyPem.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s+|\n/g, '');
        let binaryDer = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));
        const key = await crypto.subtle.importKey(
            "spki",
            binaryDer.buffer,
            { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
            false,
            ["verify"]
        );

        // 3. 解码签名 (Base64)
        const signatureBin = Uint8Array.from(atob(sign), c => c.charCodeAt(0));

        // 4. 验证
        return await crypto.subtle.verify(
            "RSASSA-PKCS1-v1_5",
            key,
            signatureBin.buffer,
            new TextEncoder().encode(sortedParams)
        );
    } catch (e) {
        console.error('Alipay verify error:', e);
        return false;
    }
}


// === 易支付 (EasyPay) 签名与验签 —— 与 dujiao-next 同款协议 ===
// v1: MD5(排序参数串 + 商户密钥)，sign_type=MD5，下单接口 /mapi.php 或 /submit.php
// v2: RSA-SHA256(PKCS1v15) 签名，sign_type=RSA，验签用平台公钥，下单接口 /api/pay/create 或 /api/pay/submit
// 参数串规则（与 dujiao-next buildSignContent 一致）：跳过空值和 sign/sign_type，按 key ASCII 升序拼接 k=v，用 & 连接

function epaySignContent(params) {
    return Object.keys(params)
        .filter(k => k !== 'sign' && k !== 'sign_type' && params[k] !== undefined && params[k] !== null && String(params[k]) !== '')
        .sort()
        .map(k => `${k}=${params[k]}`)
        .join('&');
}

async function epaySignMD5(content, merchantKey) {
    const hashBuffer = await crypto.subtle.digest('MD5', new TextEncoder().encode(content + (merchantKey || '')));
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// --- RSA 密钥处理 (兼容 PKCS#8/PKCS#1 私钥、SPKI/PKCS#1 公钥，与 dujiao-next parseRSA* 一致) ---
function derLen(n) {
    if (n < 0x80) return Uint8Array.of(n);
    const bytes = [];
    let x = n;
    while (x > 0) { bytes.unshift(x & 0xff); x >>= 8; }
    return Uint8Array.of(0x80 | bytes.length, ...bytes);
}
function derConcat(...parts) {
    const total = parts.reduce((s, p) => s + p.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const p of parts) { out.set(p, off); off += p.length; }
    return out;
}
const epayHexToBytes = (hex) => Uint8Array.from(hex.match(/.{1,2}/g).map(h => parseInt(h, 16)));

function epayStripPem(pem) {
    return String(pem || '')
        .replace(/\\n/g, '\n')
        .replace(/-----BEGIN [^-]+-----|-----END [^-]+-----|\s+/g, '');
}

// 把 PKCS#1 裸 DER 包成 PKCS#8(私钥) / SPKI(公钥)，让 WebCrypto 能导入
function epayWrapPkcs8(pkcs1Der) {
    const oidRsa = epayHexToBytes('300d06092a864886f70d0101010500');
    const octet = derConcat(Uint8Array.of(0x04), derLen(pkcs1Der.length), pkcs1Der);
    const content = derConcat(Uint8Array.of(0x02, 0x01, 0x00), oidRsa, octet);
    return derConcat(Uint8Array.of(0x30), derLen(content.length), content);
}
function epayWrapSpki(pkcs1Der) {
    const oidRsa = epayHexToBytes('300d06092a864886f70d0101010500');
    const bitStr = derConcat(Uint8Array.of(0x00), pkcs1Der);
    const inner = derConcat(Uint8Array.of(0x03), derLen(bitStr.length), bitStr);
    const content = derConcat(oidRsa, inner);
    return derConcat(Uint8Array.of(0x30), derLen(content.length), content);
}

async function epayImportPrivateKey(pem) {
    const der = Uint8Array.from(atob(epayStripPem(pem)), c => c.charCodeAt(0));
    const alg = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
    try {
        return await crypto.subtle.importKey('pkcs8', der.buffer, alg, false, ['sign']);
    } catch (e) {}
    try {
        return await crypto.subtle.importKey('pkcs8', epayWrapPkcs8(der).buffer, alg, false, ['sign']);
    } catch (e) {
        throw new Error('易支付商户私钥解析失败，请使用 PKCS#8 或 PKCS#1 格式的 RSA 私钥');
    }
}

async function epayImportPublicKey(pem) {
    const der = Uint8Array.from(atob(epayStripPem(pem)), c => c.charCodeAt(0));
    const alg = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
    try {
        return await crypto.subtle.importKey('spki', der.buffer, alg, false, ['verify']);
    } catch (e) {}
    try {
        return await crypto.subtle.importKey('spki', epayWrapSpki(der).buffer, alg, false, ['verify']);
    } catch (e) {
        throw new Error('易支付平台公钥解析失败，请使用 SPKI 或 PKCS#1 格式的 RSA 公钥');
    }
}

async function epaySignRSA(content, privatePem) {
    const key = await epayImportPrivateKey(privatePem);
    const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(content));
    return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

async function epayVerifyRSA(content, signB64, publicPem) {
    try {
        const key = await epayImportPublicKey(publicPem);
        const sig = Uint8Array.from(atob(String(signB64 || '').trim()), c => c.charCodeAt(0));
        return await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, sig.buffer, new TextEncoder().encode(content));
    } catch (e) {
        console.error('Epay RSA verify error:', e);
        return false;
    }
}

// 易支付支付方式映射 (与 dujiao-next resolvePayType 一致：wechat/wxpay→wxpay，alipay→alipay，qqpay→qqpay)
function resolveEpayPayType(channelType) {
    const t = String(channelType || '').toLowerCase().trim();
    if (t === 'wechat' || t === 'wxpay') return 'wxpay';
    if (t === 'alipay') return 'alipay';
    if (t === 'qqpay') return 'qqpay';
    return t; // 兼容旧配置中的其他类型（usdt/bank 等）
}

// [验签] 易支付异步回调验签 (v1 MD5 / v2 RSA，与 dujiao-next VerifyCallback 一致)
async function verifyEpayCallback(config, params) {
    try {
        const sign = String(params.sign || '').trim();
        if (!sign) return false;
        const content = epaySignContent(params);
        const version = String(config.epay_version || '').toLowerCase().trim();
        if (version === 'v2') {
            return await epayVerifyRSA(content, sign, config.platform_public_key);
        }
        const expected = await epaySignMD5(content, config.merchant_key);
        return expected.toLowerCase() === sign.toLowerCase();
    } catch (e) {
        console.error('Epay verify error:', e);
        return false;
    }
}

/**
 * [辅助] Web Crypto 不原生支持 MD5，这里用纯 JS 实现
 */
(function() {
    // 简洁的 MD5 实现 (用于 Worker 环境)
    function md5cycle(x, k) {
        let a = x[0], b = x[1], c = x[2], d = x[3];
        a = ff(a, b, c, d, k[0], 7, -680876936); d = ff(d, a, b, c, k[1], 12, -389564586);
        c = ff(c, d, a, b, k[2], 17, 606105819); b = ff(b, c, d, a, k[3], 22, -1044525330);
        a = ff(a, b, c, d, k[4], 7, -176418897); d = ff(d, a, b, c, k[5], 12, 1200080426);
        c = ff(c, d, a, b, k[6], 17, -1473231341); b = ff(b, c, d, a, k[7], 22, -45705983);
        a = ff(a, b, c, d, k[8], 7, 1770035416); d = ff(d, a, b, c, k[9], 12, -1958414417);
        c = ff(c, d, a, b, k[10], 17, -42063); b = ff(b, c, d, a, k[11], 22, -1990404162);
        a = ff(a, b, c, d, k[12], 7, 1804603682); d = ff(d, a, b, c, k[13], 12, -40341101);
        c = ff(c, d, a, b, k[14], 17, -1502002290); b = ff(b, c, d, a, k[15], 22, 1236535329);
        a = gg(a, b, c, d, k[1], 5, -165796510); d = gg(d, a, b, c, k[6], 9, -1069501632);
        c = gg(c, d, a, b, k[11], 14, 643717713); b = gg(b, c, d, a, k[0], 20, -373897302);
        a = gg(a, b, c, d, k[5], 5, -701558691); d = gg(d, a, b, c, k[10], 9, 38016083);
        c = gg(c, d, a, b, k[15], 14, -660478335); b = gg(b, c, d, a, k[4], 20, -405537848);
        a = gg(a, b, c, d, k[9], 5, 568446438); d = gg(d, a, b, c, k[14], 9, -1019803690);
        c = gg(c, d, a, b, k[3], 14, -187363961); b = gg(b, c, d, a, k[8], 20, 1163531501);
        a = gg(a, b, c, d, k[13], 5, -1444681467); d = gg(d, a, b, c, k[2], 9, -51403784);
        c = gg(c, d, a, b, k[7], 14, 1735328473); b = gg(b, c, d, a, k[12], 20, -1926607734);
        a = hh(a, b, c, d, k[5], 4, -378558); d = hh(d, a, b, c, k[8], 11, -2022574463);
        c = hh(c, d, a, b, k[11], 16, 1839030562); b = hh(b, c, d, a, k[14], 23, -35309556);
        a = hh(a, b, c, d, k[1], 4, -1530992060); d = hh(d, a, b, c, k[4], 11, 1272893353);
        c = hh(c, d, a, b, k[7], 16, -155497632); b = hh(b, c, d, a, k[10], 23, -1094730640);
        a = hh(a, b, c, d, k[13], 4, 681279174); d = hh(d, a, b, c, k[0], 11, -358537222);
        c = hh(c, d, a, b, k[3], 16, -722521979); b = hh(b, c, d, a, k[6], 23, 76029189);
        a = hh(a, b, c, d, k[9], 4, -640364487); d = hh(d, a, b, c, k[12], 11, -421815835);
        c = hh(c, d, a, b, k[15], 16, 530742520); b = hh(b, c, d, a, k[2], 23, -995338651);
        a = ii(a, b, c, d, k[0], 6, -198630844); d = ii(d, a, b, c, k[7], 10, 1126891415);
        c = ii(c, d, a, b, k[14], 15, -1416354905); b = ii(b, c, d, a, k[5], 21, -57434055);
        a = ii(a, b, c, d, k[12], 6, 1700485571); d = ii(d, a, b, c, k[3], 10, -1894986606);
        c = ii(c, d, a, b, k[10], 15, -1051523); b = ii(b, c, d, a, k[1], 21, -2054922799);
        a = ii(a, b, c, d, k[8], 6, 1873313359); d = ii(d, a, b, c, k[15], 10, -30611744);
        c = ii(c, d, a, b, k[6], 15, -1560198380); b = ii(b, c, d, a, k[13], 21, 1309151649);
        a = ii(a, b, c, d, k[4], 6, -145523070); d = ii(d, a, b, c, k[11], 10, -1120210379);
        c = ii(c, d, a, b, k[2], 15, 718787259); b = ii(b, c, d, a, k[9], 21, -343485551);
        x[0] = add32(a, x[0]); x[1] = add32(b, x[1]); x[2] = add32(c, x[2]); x[3] = add32(d, x[3]);
    }
    function cmn(q, a, b, x, s, t) { a = add32(add32(a, q), add32(x, t)); return add32((a << s) | (a >>> (32 - s)), b); }
    function ff(a, b, c, d, x, s, t) { return cmn((b & c) | ((~b) & d), a, b, x, s, t); }
    function gg(a, b, c, d, x, s, t) { return cmn((b & d) | (c & (~d)), a, b, x, s, t); }
    function hh(a, b, c, d, x, s, t) { return cmn(b ^ c ^ d, a, b, x, s, t); }
    function ii(a, b, c, d, x, s, t) { return cmn(c ^ (b | (~d)), a, b, x, s, t); }
    function md51(s) {
        const n = s.length;
        let state = [1732584193, -271733879, -1732584194, 271733878];
        let i;
        for (i = 64; i <= n; i += 64) md5cycle(state, md5blk(s.substring(i - 64, i)));
        s = s.substring(i - 64);
        const tail = [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0];
        for (i = 0; i < s.length; i++) tail[i >> 2] |= s.charCodeAt(i) << ((i % 4) << 3);
        tail[i >> 2] |= 0x80 << ((i % 4) << 3);
        if (i > 55) { md5cycle(state, tail); for (i = 0; i < 16; i++) tail[i] = 0; }
        tail[14] = n * 8;
        md5cycle(state, tail);
        return state;
    }
    function md5blk(s) {
        const md5blks = [];
        for (let i = 0; i < 64; i += 4) md5blks[i >> 2] = s.charCodeAt(i) + (s.charCodeAt(i+1) << 8) + (s.charCodeAt(i+2) << 16) + (s.charCodeAt(i+3) << 24);
        return md5blks;
    }
    function add32(a, b) { return (a + b) & 0xFFFFFFFF; }
    function rhex(n) {
        const hc = '0123456789abcdef';
        let s = '';
        for (let j = 0; j < 4; j++) s += hc.charAt((n >> (j * 8 + 4)) & 0x0F) + hc.charAt((n >> (j * 8)) & 0x0F);
        return s;
    }
    // 覆盖 crypto.subtle.digest('MD5') —— Web Crypto 标准不支持 MD5，需要自行注册
    const _origDigest = crypto.subtle.digest.bind(crypto.subtle);
    crypto.subtle.digest = async function(algorithm, data) {
        if (typeof algorithm === 'string' && algorithm.toUpperCase() === 'MD5') {
            const bytes = new Uint8Array(data);
            let s = '';
            for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
            const state = md51(s);
            const result = new Uint8Array(16);
            for (let i = 0; i < 4; i++) {
                result[i*4] = state[i] & 0xFF;
                result[i*4+1] = (state[i] >> 8) & 0xFF;
                result[i*4+2] = (state[i] >> 16) & 0xFF;
                result[i*4+3] = (state[i] >> 24) & 0xFF;
            }
            return result.buffer;
        }
        return _origDigest(algorithm, data);
    };
})();

// [C优化] rate_limits 建表标记：本实例建过一次后跳过，减少每请求一次 D1 往返
let _rateLimitsTableReady = false;

// === 登录页服务端直出 Logo ===
// 作用：把数据库里的 site_logo / site_name 直接渲染进登录页 HTML，
// 让 <img> 随首屏并行下载（不再等 /api/shop/config 返回后才由 JS 注入）。
// 安全性：任何异常都回退到原始静态文件；占位符未命中则保持原样交由前端 JS 兜底，
// 确保登录页在任何情况下都不会被破坏。
async function serveLoginHtml(env, url, assetPath) {
    const fetchAsset = () => env.ASSETS.fetch(new Request(new URL(assetPath, url.origin), { method: 'GET', headers: { 'X-Internal-Asset': '1' } }));
    try {
        const resp = await fetchAsset();
        if (!resp || resp.status !== 200) return resp;
        const ct = (resp.headers.get('content-type') || '');
        if (ct && ct.indexOf('text/html') === -1) return resp;
        let html = await resp.text();
        let headerInner = '';
        let headInject = '';
        try {
            const db = env.xyfk;
            const rows = await db.prepare("SELECT key, value FROM site_config WHERE key IN ('site_logo','site_name','member_enabled')").all();
            const c = {};
            if (rows && rows.results) rows.results.forEach(r => { c[r.key] = r.value; });
            const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            if (c.site_logo) {
                headerInner = '<img id="site-logo" src="' + esc(c.site_logo) + '" alt="Logo" style="max-height: 47px; max-width: 100%;">';
                headInject += '<link rel="preload" as="image" href="' + esc(c.site_logo) + '">';
            } else {
                const fallback = (assetPath.indexOf('/member/') === 0) ? '会员中心' : 'XYRJFK后台登录';
                headerInner = '<h1 style="margin: 0; font-size: 24px; color: #333;">' + esc(c.site_name || fallback) + '</h1>';
            }
            // 会员登录页：注册被后台关闭时，服务端直接渲染正确初始可见性，消除“先闪出注册/后隐藏”的抖动
            if (assetPath.indexOf('/member/') === 0 && c.member_enabled !== '1') {
                headInject += '<style>#register-tab{display:none!important}#reg-closed-notice{display:block!important}.auth-tabs{margin-bottom:0!important}</style>';
            }
        } catch (e) { /* 读取配置失败：保留占位符，交由前端 JS 兜底渲染 */ }
        if (headerInner) html = html.split('<!--XYRJ_LOGIN_HEADER-->').join(headerInner);
        if (headInject) html = html.replace('</head>', headInject + '</head>');
        return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' } });
    } catch (e) {
        try { return await fetchAsset(); } catch (e2) { return new Response('Internal Error', { status: 500 }); }
    }
}

// === 主入口 ===
export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const path = url.pathname;

        // [循环保护] 内部资源请求直接透传，不走任何路由
        if (request.headers.get('X-Internal-Asset') === '1') {
            return env.ASSETS.fetch(request);
        }
        // === [新增] 访客被动触发机制 (7天自动执行一次刷新Outlook邮箱的Token) ===
        try {
            ctx.waitUntil((async () => {
                const db = env.xyfk;
                const now = Math.floor(Date.now() / 1000);
                let lastTime = 0;
                
                try {
                    // 查询上次刷新的时间记录
                    const row = await db.prepare("SELECT value FROM site_config WHERE key = 'last_outlook_refresh_time'").first();
                    if (row && row.value) lastTime = parseInt(row.value);
                } catch(e) {}

                // 604800秒 = 7天。如果当前时间距离上次刷新超过7天，则触发
                if (now - lastTime > 604800) {
                    // 1. 抢先更新数据库的时间戳，防止同一时间多个访客导致重复执行
                    await db.prepare("INSERT INTO site_config (key, value) VALUES ('last_outlook_refresh_time', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(now.toString()).run();
                    
                    // 2. 内部静默请求你的刷新 API
                    await refreshOutlookTokens(db);
                    console.log("被动触发成功：已刷新 Outlook Token");
                }
            })());
        } catch (e) {
            console.error("被动触发器异常:", e);
        }
        
        if (path === '/favicon.ico') {
            try {
                const db = env.xyfk;
                const faviconConf = await db.prepare("SELECT value FROM site_config WHERE key='site_favicon'").first();
                if (faviconConf && faviconConf.value) {
                     const targetUrl = faviconConf.value.startsWith('http') ? faviconConf.value : url.origin + faviconConf.value;
                     return Response.redirect(targetUrl, 302);
                }
            } catch(e) {}
            return Response.redirect(url.origin + '/assets/xyrjico.webp', 302);
        }

        // === 1. API 路由处理 ===
        if (path.startsWith('/api/')) {
            return handleApi(request, env, url, ctx);
        }

        // === 2. 静态资源路由重写 (Pretty URLs 逻辑) ===
        
        let theme = 'default';
        try {
            const db = env.xyfk;
            const t = await db.prepare("SELECT value FROM site_config WHERE key='theme'").first();
            if(t && t.value) theme = t.value;
        } catch(e) {}

        // [新增] 将 /files/ 路径映射到 /themes/当前主题/files/
        if (path.startsWith('/files/')) {
             const newUrl = new URL(`/themes/${theme}${path}`, url.origin);
             return env.ASSETS.fetch(new Request(newUrl, request));
        }
        
        // 规则 A: 排除不需要重写的系统路径
        if (path.startsWith('/admin/')) {
             // 管理员登录页：服务端直出 Logo（异常自动回退原始静态页）
             if (path === '/admin/' || path === '/admin/index.html') {
                 return serveLoginHtml(env, url, '/admin/index.html');
             }
             return env.ASSETS.fetch(request);
        }
        if (path.startsWith('/themes/') || path.startsWith('/assets/')) {
             return env.ASSETS.fetch(request);
        }

        // === 会员页面路由 ===
        if (path === '/member/login' || path === '/member/login.html') {
            // 会员登录页：服务端直出 Logo（异常自动回退原始静态页）
            return serveLoginHtml(env, url, '/member/login.html');
        }
        if (path === '/member/' || path === '/member/index.html') {
            return Response.redirect(url.origin + '/member', 301);
        }
        if (path === '/member') {
            const newUrl = new URL('/member/index.html', url.origin);
            const internalReq = new Request(newUrl, { method: request.method, headers: { 'X-Internal-Asset': '1' } });
            return env.ASSETS.fetch(internalReq);
        }

        // ============================================================
        // === SEO 注入核心逻辑 (包含首页、商品、文章) ===
        // ============================================================
        
        // 规则 B: 根路径处理 (首页)
        if (path === '/' || path === '/index.html') {
             const newUrl = new URL(`/themes/${theme}/`, url.origin);
             const newRequest = new Request(newUrl, request);
             
             let response = await env.ASSETS.fetch(newRequest);
             
             // 首页 SEO 注入
             if (response.status === 200) {
                 try {
                     const db = env.xyfk;
                     const configRes = await db.prepare("SELECT * FROM site_config").all();
                     const config = {}; 
                     if (configRes && configRes.results) {
                         configRes.results.forEach(r => config[r.key] = r.value);
                     }

                     const siteName = (config.site_name || '夏雨自动发货系统').replace(/"/g, '&quot;');
                     const siteDesc = (config.site_description || '自动发货，安全快捷，夏雨自动发货系统').replace(/"/g, '&quot;');
                     let siteImage = config.seo_image || '';
                     if (siteImage && siteImage.startsWith('/')) siteImage = `${url.origin}${siteImage}`;
                     const siteFavicon = config.site_favicon || '';

                     response = await injectMetaTags(response, {
                         url: request.url,
                         title: siteName,
                         desc: siteDesc,
                         image: siteImage,
                         favicon: siteFavicon
                     });
                 } catch (e) { console.error('Home SEO Error:', e); }
             }
             return response;
        }
        
        // 规则 C: 普通 HTML 页面 (商品详情、文章详情等)
        if ((!path.includes('.') || path.endsWith('.html')) && !path.startsWith('/api/') && !path.startsWith('/admin/') && !path.startsWith('/assets/') && !path.startsWith('/themes/') && !path.startsWith('/member/')) {
            // 如果路径带 .html 则去掉，确保内部统一请求无后缀路径 (Cloudflare Pages 会自动匹配 .html)
            const cleanPath = path.endsWith('.html') ? path.replace(/\.html$/, '') : path;
            const newUrl = new URL(`/themes/${theme}${cleanPath}`, url.origin);
            const newRequest = new Request(newUrl, request);
            
            let response = await env.ASSETS.fetch(newRequest);
            // 如果找不到文件，回退去请求原始路径
            if (response.status === 404) {
                 response = await env.ASSETS.fetch(request);
            }

            // SEO 注入
            if (response.status === 200) {
                const db = env.xyfk;
                // 获取后台单独设置的 SEO 封面图和 Favicon
                let globalSeoImage = '';
                let siteFavicon = '';
                try {
                    const seoRes = await db.prepare("SELECT key, value FROM site_config WHERE key IN ('seo_image', 'site_favicon')").all();
                    if (seoRes && seoRes.results) {
                        seoRes.results.forEach(r => {
                            if (r.key === 'seo_image' && r.value) globalSeoImage = r.value.startsWith('/') ? `${url.origin}${r.value}` : r.value;
                            if (r.key === 'site_favicon') siteFavicon = r.value || '';
                        });
                    }
                } catch(e) {}

                // --- 情况1：商品详情页 (product.html) ---
                if (path === '/product' || path === '/product.html') {
                    const id = url.searchParams.get('id');
                    if (id) {
                        try {
                            const item = await db.prepare("SELECT name, description, image_url, seo_description FROM products WHERE id = ?").bind(id).first();
                            if (item) {
                                let desc = item.seo_description || (item.description || '').replace(/<[^>]+>/g, '').substring(0, 150) + '...';
                                if(!desc || desc === '...') desc = '自动发货，安全快捷，夏雨自动发货系统';
                                let image = item.image_url || '/assets/xyrjlogo.webp';
                                if (image.startsWith('/')) image = `${url.origin}${image}`;
                                
                                response = await injectMetaTags(response, {
                                    url: request.url,
                                    title: item.name,
                                    desc: desc,
                                    image: image,
                                    favicon: siteFavicon
                                });
                            }
                        } catch(e) {}
                    }
                }
                
                // --- 情况2：文章详情页 (article.html) ---
                else if (path === '/article' || path === '/article.html') {
                    const id = url.searchParams.get('id');
                    if (id) {
                        try {
                            const item = await db.prepare("SELECT title, content, cover_image, seo_description FROM articles WHERE id = ?").bind(id).first();
                            if (item) {
                                // 提取纯文本摘要 (优先使用 SEO 描述)
                                let desc = item.seo_description || (item.content || '').replace(/<[^>]+>/g, '').substring(0, 150) + '...';
                                // 优先用封面图，没有则尝试提取文章内第一张图
                                let image = item.cover_image;
                                if (!image && item.content) {
                                    const imgMatch = item.content.match(/<img[^>]+src="([^">]+)"/);
                                    if (imgMatch) image = imgMatch[1];
                                }
                                if (!image) image = '/assets/xyrjlogo.webp';
                                if (image.startsWith('/')) image = `${url.origin}${image}`;

                                response = await injectMetaTags(response, {
                                    url: request.url,
                                    title: item.title,
                                    desc: desc,
                                    image: image,
                                    favicon: siteFavicon
                                });
                            }
                        } catch(e) {}
                    }
                }

                // --- 情况3：文章中心 (articles.html) ---
                else if (path === '/articles' || path === '/articles.html') {
                    response = await injectMetaTags(response, {
                        url: request.url,
                        title: '文章中心-教程与公告',
                        desc: '查看最新的店铺公告、使用教程和行业资讯。',
                        image: globalSeoImage,
                        favicon: siteFavicon
                    });
                }
                // --- 情况4：自定义单页 (custom.html) ---
                else if (path === '/custom' || path === '/custom.html') {
                    const alias = url.searchParams.get('alias');
                    if (alias) {
                        try {
                            const item = await db.prepare("SELECT title, content, seo_description FROM pages WHERE alias = ?").bind(alias).first();
                            if (item) {
                                let desc = item.seo_description || (item.content || '').replace(/<[^>]+>/g, '').substring(0, 150) + '...';
                                response = await injectMetaTags(response, {
                                    url: request.url,
                                    title: item.title,
                                    desc: desc,
                                    image: globalSeoImage,
                                    favicon: siteFavicon
                                });
                            }
                        } catch(e) {}
                    }
                }
            }

            return response;
        }
        // ====== [新增] Telegram 图片代理 ======
        if (path.startsWith('/tg_image/')) {
            const filePath = path.replace('/tg_image/', '');
            if (!/\.(jpg|jpeg|png|gif|webp)$/i.test(filePath)) return new Response('Forbidden', { status: 403 });
            if (filePath.includes('..') || filePath.includes('?')) {
                return new Response('Forbidden', { status: 403 });
            }
            let token = '';
            try {
                const db = env.xyfk;
                const row = await db.prepare("SELECT value FROM site_config WHERE key = 'tg_upload_bot_token'").first();
                if (row) token = row.value;
            } catch(e) {}
            if (!token) return new Response('Config missing', { status: 404 });
            
            const tgUrl = `https://api.telegram.org/file/bot${token}/${filePath}`;
            const imgRes = await fetch(tgUrl);
            if (!imgRes.ok) return new Response('Image not found', { status: 404 });

            const newHeaders = new Headers(imgRes.headers);
            newHeaders.set('Access-Control-Allow-Origin', '*');
            newHeaders.set('Cache-Control', 'public, max-age=2592000');
            return new Response(imgRes.body, { status: imgRes.status, headers: newHeaders });
        }

        // ====== [新增] R2 图片代理路由 ======
        if (path.startsWith('/r2_image/')) {
            if (!env.r2) return new Response('R2 not configured', { status: 500 });
            const key = path.replace('/r2_image/', '');
            if (!key || key.includes('..') || key.includes('?')) return new Response('Forbidden', { status: 403 });
            
            const object = await env.r2.get(key);
            if (!object) return new Response('Not Found', { status: 404 });
            
            const headers = new Headers();
            headers.set('Content-Type', object.httpMetadata?.contentType || 'image/jpeg');
            headers.set('Cache-Control', 'public, max-age=2592000');
            headers.set('Access-Control-Allow-Origin', '*');
            return new Response(object.body, { headers });
        }
        // === 3. 默认回退 ===
        return env.ASSETS.fetch(request);
    }
};

// =============================================
// === 辅助函数：注入 Meta 标签 (用于SEO) ===
// =============================================
async function injectMetaTags(originalResponse, data) {
// 【安全修复】转义特殊字符，防止 XSS 攻击
    const escape = (str) => (str || '').replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
    const title = escape(data.title);
    const desc = escape(data.desc);
    // 这里决定图片显示模式：
    // 'summary_large_image' = 大图 (适合宽屏图)
    // 'summary'             = 小图 (适合正方形图，图片在文字旁)
    const cardType = 'summary'; 
    // Favicon 标签 (兼容搜狗等非 Chrome 内核浏览器)
    const faviconTag = data.favicon ? `<link rel="icon" href="${escape(data.favicon)}">` : '';
     // 构造 Open Graph 和 Twitter Card 标签
    const tags = `
        ${faviconTag}
        <meta property="og:type" content="website">
        <meta property="og:url" content="${data.url}">
        <meta property="og:title" content="${title}">
        <meta property="og:description" content="${desc}">
        <meta property="og:image" content="${data.image}">
        <meta property="twitter:card" content="${cardType}">
        <meta property="twitter:title" content="${title}">
        <meta property="twitter:description" content="${desc}">
        <meta property="twitter:image" content="${data.image}">
    `;
    // 读取 HTML 内容并注入到 <head> 之后
    let html = await originalResponse.text();
    html = html.replace('<head>', `<head>${tags}`);
    // 返回新的 Response 对象
    return new Response(html, {
        headers: originalResponse.headers,
        status: originalResponse.status,
        statusText: originalResponse.statusText
    });
}

// =============================================
// === 完整的 API 处理逻辑 ===
// =============================================// === Outlook Token 刷新核心逻辑（被动触发和 Cron 端点共用） ===
async function refreshOutlookTokens(db) {
    const keys = [
        'outlook_active', 'outlook_client_id', 'outlook_client_secret', 'outlook_refresh_token',
        'customer_outlook_active', 'customer_outlook_client_id', 'customer_outlook_client_secret', 'customer_outlook_refresh_token'
    ];
    const placeholders = keys.map(() => '?').join(',');
    const confRes = await db.prepare(`SELECT key, value FROM site_config WHERE key IN (${placeholders})`).bind(...keys).all();
    const config = {};
    if (confRes && confRes.results) confRes.results.forEach(r => config[r.key] = r.value);

    const logs = [];
    const refreshTokenLogic = async (prefix) => {
        const active = config[`${prefix}_active`];
        const clientId = config[`${prefix}_client_id`];
        const clientSecret = config[`${prefix}_client_secret`] || '';
        const refreshToken = config[`${prefix}_refresh_token`];
        if (active !== '1' || !clientId || !refreshToken) {
            logs.push(`[${prefix}] Skipped: Not active or missing config`);
            return;
        }
        try {
            const tokenUrl = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
            const params = new URLSearchParams();
            params.append('client_id', clientId);
            if (clientSecret) params.append('client_secret', clientSecret);
            params.append('refresh_token', refreshToken);
            params.append('grant_type', 'refresh_token');
            params.append('scope', 'Mail.Send offline_access');
            const tokenRes = await fetch(tokenUrl, { method: 'POST', body: params });
            const tokenData = await tokenRes.json();
            if (tokenData.refresh_token) {
                const dbKey = `${prefix}_refresh_token`;
                await db.prepare(`INSERT INTO site_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(dbKey, tokenData.refresh_token).run();
                logs.push(`[${prefix}] Success: Token refreshed and saved.`);
            } else if (tokenData.access_token) {
                logs.push(`[${prefix}] Success: Access Token retrieved (No new Refresh Token).`);
            } else {
                logs.push(`[${prefix}] Failed: ${tokenData.error_description || JSON.stringify(tokenData)}`);
            }
        } catch (e) {
            logs.push(`[${prefix}] Error: ${e.message}`);
        }
    };
    await Promise.all([refreshTokenLogic('outlook'), refreshTokenLogic('customer_outlook')]);
    return logs;
}


// [新增] 会员系统表结构兼容初始化：旧数据库（无会员系统的旧版建库）自动补齐缺失的表和列，全部幂等不报错
// [性能优化] 每个运行实例只执行一次，避免每个请求都跑 DDL（失败的 ALTER 同样消耗 D1 往返）拖慢接口
let _memberSchemaEnsured = false;
async function ensureMemberTables(db) {
    if (_memberSchemaEnsured) return;
    try {
        await db.prepare(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT DEFAULT '',
            password_hash TEXT NOT NULL,
            password_encrypted TEXT,
            email TEXT UNIQUE,
            balance REAL DEFAULT 0,
            frozen INTEGER DEFAULT 0,
            member_level INTEGER DEFAULT 0,
            total_recharge REAL DEFAULT 0,
            -- [v1] 自助充值限额：单笔/累计，0 = 不限
            recharge_limit_per_tx REAL DEFAULT 0,
            recharge_limit_total REAL DEFAULT 0,
            -- [v1] 等级来源：auto = 自动升级规则管；manual = 管理员手动设定（优先级最高）
            auto_level INTEGER DEFAULT 0,
            level_source TEXT DEFAULT 'auto',
            -- [v1] 累计入金 = 自助充值 + 管理员手动加余额（自动升级规则的判定口径）
            total_incoming REAL DEFAULT 0,
            created_at INTEGER,
            updated_at INTEGER
        )`).run();
    } catch(e) {}
    try {
        await db.prepare(`CREATE TABLE IF NOT EXISTS balance_transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            amount REAL NOT NULL,
            type TEXT NOT NULL,
            description TEXT,
            order_id TEXT,
            created_at INTEGER
        )`).run();
    } catch(e) {}
    // 兼容旧库缺列
    for (const ddl of [
        'ALTER TABLE users ADD COLUMN password_encrypted TEXT',
        'ALTER TABLE users ADD COLUMN frozen INTEGER DEFAULT 0',
        'ALTER TABLE users ADD COLUMN member_level INTEGER DEFAULT 0',
        'ALTER TABLE users ADD COLUMN total_recharge REAL DEFAULT 0',
        // [v1] 自助充值限额 + 等级来源 + 累计入金
        'ALTER TABLE users ADD COLUMN recharge_limit_per_tx REAL DEFAULT 0',
        'ALTER TABLE users ADD COLUMN recharge_limit_total REAL DEFAULT 0',
        'ALTER TABLE users ADD COLUMN auto_level INTEGER DEFAULT 0',
        "ALTER TABLE users ADD COLUMN level_source TEXT DEFAULT 'auto'",
        'ALTER TABLE users ADD COLUMN total_incoming REAL DEFAULT 0',
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email)',
        'ALTER TABLE orders ADD COLUMN user_id INTEGER',
        // [性能优化] 会员列表/详情的关联查询走索引，避免 orders 增长后逐行全表扫描
        'CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id)',
        'CREATE INDEX IF NOT EXISTS idx_balance_transactions_user_id ON balance_transactions(user_id)',
        'CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at)'
    ]) {
        try { await db.prepare(ddl).run(); } catch(e) {}
    }
    // [v1] 存量数据一次性回填（幂等：用 site_config 打标，只跑一次）
    try {
        const migFlag = await db.prepare("SELECT value FROM site_config WHERE key='member_migration_v1'").first();
        if (!migFlag) {
            // 回填 auto_level / total_incoming，并保留管理员已设置的等级（level_source 默认 auto，不影响现有 member_level）
            await db.prepare('UPDATE users SET auto_level = member_level WHERE member_level > 0').run();
            await db.prepare('UPDATE users SET total_incoming = total_recharge WHERE total_recharge > 0').run();
            await db.prepare("INSERT OR IGNORE INTO site_config (key, value) VALUES ('member_migration_v1','1')").run();
        }
    } catch(e) {}
    // [v1] 站点级默认值（新会员继承；后台可逐会员覆盖）
    for (const [k, v] of [
        ['member_recharge_limit_per_tx_default', '0'],   // 新会员默认单笔自助充值限额，0=不限
        ['member_recharge_limit_total_default',  '0'],   // 新会员默认累计自助充值限额，0=不限
        ['recharge_max_per_tx',                  '10000'] // 全局单笔充值上限（与会员个人限额取小者）
    ]) {
        try { await db.prepare('INSERT OR IGNORE INTO site_config (key, value) VALUES (?, ?)').bind(k, v).run(); } catch(e) {}
    }
    _memberSchemaEnsured = true;
}

// [新增] 支付网关表兼容初始化：旧库自动补 member_recharge 列（会员充值开关），幂等不报错
// [性能优化] 同样每个运行实例只执行一次
let _payGatewaySchemaEnsured = false;
async function ensurePayGatewayColumns(db) {
    if (_payGatewaySchemaEnsured) return;
    try { await db.prepare('ALTER TABLE pay_gateways ADD COLUMN member_recharge INTEGER DEFAULT 0').run(); } catch(e) {}
    _payGatewaySchemaEnsured = true;
}

// [新增] 商品表兼容初始化：旧库自动补 member_price_enabled 列（商品级“会员价”开关，默认开启），幂等不报错
// [性能优化] 同样每个运行实例只执行一次
let _productSchemaEnsured = false;
async function ensureProductColumns(db) {
    if (_productSchemaEnsured) return;
    try { await db.prepare('ALTER TABLE products ADD COLUMN member_price_enabled INTEGER DEFAULT 1').run(); } catch(e) {}
    // [v2] 商品是否允许被 API 调用购买（默认关闭，需后台逐个开启）
    try { await db.prepare('ALTER TABLE products ADD COLUMN api_enabled INTEGER DEFAULT 0').run(); } catch(e) {}
    // [修复] 增量同步缺 updated_at：原方案只给 products 补了，漏了 variants / categories，
    //        导致「只改规格价格/库存」的变更不会让下游 updated_after 发现，同步漏单。
    //        这里三张表都补上，并由下面的触发器统一联动。
    try { await db.prepare('ALTER TABLE products ADD COLUMN updated_at INTEGER').run(); } catch(e) {}
    try { await db.prepare('ALTER TABLE variants ADD COLUMN updated_at INTEGER').run(); } catch(e) {}
    try { await db.prepare('ALTER TABLE categories ADD COLUMN updated_at INTEGER').run(); } catch(e) {}
    // [修复] 存量回填：让历史行有确定的变更时间，否则 updated_after 过滤对旧行永远失效。
    //        幂等（只填 NULL），且只跑一次。
    try { await db.prepare('UPDATE products SET updated_at = created_at WHERE updated_at IS NULL').run(); } catch(e) {}
    try { await db.prepare('UPDATE variants SET updated_at = created_at WHERE updated_at IS NULL').run(); } catch(e) {}
    await ensureProductTouchTriggers(db);
    _productSchemaEnsured = true;
}

// [修复] 规格/卡密变更联动推高 products.updated_at。
// 为什么用触发器而不是在每处 JS 里补一行：variants 的写操作散布在 20+ 处
// （商品保存、商品导入、卡密导入/删除、下单扣库存、取消回滚、上游同步……），
// 手工逐个补必然漏；触发器在 SQL 层兜底，任何现有/未来的写入都覆盖。
// 触发器均为 IF NOT EXISTS，重复执行无副作用；单条 UPDATE 成本可忽略。
// 注：卡密只在 status 变更（占用/释放）时触发，避免大批量导入卡密时逐行回写。
let _productTouchTriggersEnsured = false;
async function ensureProductTouchTriggers(db) {
    if (_productTouchTriggersEnsured) return;
    const nowSql = "CAST(strftime('%s','now') AS INTEGER)";
    const triggers = [
        `CREATE TRIGGER IF NOT EXISTS trg_variants_touch_product_ai AFTER INSERT ON variants BEGIN
            UPDATE products SET updated_at = ${nowSql} WHERE id = NEW.product_id;
         END`,
        `CREATE TRIGGER IF NOT EXISTS trg_variants_touch_product_au AFTER UPDATE ON variants BEGIN
            UPDATE products SET updated_at = ${nowSql} WHERE id = NEW.product_id;
         END`,
        `CREATE TRIGGER IF NOT EXISTS trg_variants_touch_product_ad AFTER DELETE ON variants BEGIN
            UPDATE products SET updated_at = ${nowSql} WHERE id = OLD.product_id;
         END`,
        `CREATE TRIGGER IF NOT EXISTS trg_cards_touch_product_au AFTER UPDATE OF status ON cards BEGIN
            UPDATE products SET updated_at = ${nowSql}
             WHERE id IN (SELECT product_id FROM variants WHERE id = NEW.variant_id);
         END`,
    ];
    for (const ddl of triggers) {
        try { await db.prepare(ddl).run(); } catch(e) {}
    }
    _productTouchTriggersEnsured = true;
}

// [修复] 显式联动工具（触发器之外的兑底；也给 categories 用，categories 没有子表）
async function touchProductsByVariant(db, variantId) {
    try {
        await db.prepare('UPDATE products SET updated_at=? WHERE id IN (SELECT product_id FROM variants WHERE id=?)')
            .bind(time(), variantId).run();
    } catch(e) {}
}
async function touchProducts(db, productIds) {
    try {
        const ids = (Array.isArray(productIds) ? productIds : [productIds]).filter(Boolean);
        if (!ids.length) return;
        await db.prepare(`UPDATE products SET updated_at=? WHERE id IN (${ids.map(() => '?').join(',')})`)
            .bind(time(), ...ids).run();
    } catch(e) {}
}
async function touchCategory(db, catId) {
    try { await db.prepare('UPDATE categories SET updated_at=? WHERE id=?').bind(time(), catId).run(); } catch(e) {}
}
// 订单链路的卡密占用/释放只翻 cards.status、不写 variants，
// 所以取消回滚这类路径需要单独把受影响商品的变更时间推高。
async function touchProductsByOrder(db, orderId) {
    try {
        await db.prepare(`UPDATE products SET updated_at=? WHERE id IN (
            SELECT DISTINCT v.product_id FROM variants v
             WHERE v.id IN (SELECT variant_id FROM cards WHERE order_id=?))`)
            .bind(time(), orderId).run();
    } catch(e) {}
}

// [统一口径] 会员折扣解析：只认 member_levels[member_level].discount
// 下单、购物车结算、前台会员价展示全部走这一个函数；返回 1..99 = 折扣百分比，100 = 无折扣
// [修改] 折扣不再受“会员系统”总开关限制（总开关仅控制注册）：
//       折扣只由 等级配置(member_levels) + 用户等级(member_level) 决定，
//       商品级开关(member_price_enabled) 在 attachMemberPricing / 结算处另行控制
async function resolveMemberDiscount(db, memberLevel) {
    try {
        const levelsRow = await db.prepare("SELECT value FROM site_config WHERE key='member_levels'").first();
        if (levelsRow && levelsRow.value) {
            const levels = JSON.parse(levelsRow.value);
            const lvl = memberLevel ? parseInt(memberLevel) : 0;
            if (levels[lvl] && levels[lvl].discount) {
                const d = parseInt(levels[lvl].discount);
                if (d >= 1 && d < 100) return d;
            }
        }
    } catch(e) {}
    return 100;
}

// [统一口径] 为商品/规格附加预计算会员价（仅会员请求时调用）。
// 所有折扣/取整运算只发生在后端，前端只做“选择 + 展示”：
//   product.member_discount     = 折扣百分比（商品关闭会员价时也返回，便于前端提示）
//   variant.member_price        = 基准会员价（原价 × 折扣）
//   variant.member_price_select = 自选加价后的会员价（custom_markup > 0 时）
//   variant.member_wholesale    = 各批发档位的会员价 [{qty, price}]（与结算同口径 {qty, price}）
//
// [取低者] 会员折扣价 与 批发价 取较低者，不再叠加（即不再“批发价再打折”）：
//   最终单价 = min(原价 × 折扣, 数量命中的批发档位价)
//   三处（展示 / 单买结算 / 购物车结算）共用此口径，避免漂移。
function attachMemberPricing(product, variants, discount) {
    if (!(discount >= 1 && discount < 100)) return;
    product.member_discount = discount;
    if (product.member_price_enabled === 0) return;
    for (const v of variants) {
        const base = parseFloat(v.price) || 0;
        // 会员折扣价（未取整），用于与批发档位价“取低者”比较
        const memberRaw = base * discount / 100;
        v.member_price = Math.round(memberRaw * 100) / 100;
        const markup = parseFloat(v.custom_markup || 0);
        // 自选模式本就不吃批发价，维持“自选价 × 折扣”
        if (markup > 0) v.member_price_select = Math.round((base + markup) * discount / 100 * 100) / 100;
        if (v.wholesale_config) {
            let wc = v.wholesale_config;
            try { if (typeof wc === 'string') wc = JSON.parse(wc); } catch(e) { wc = null; }
            if (Array.isArray(wc)) {
                v.member_wholesale = wc.map(r => {
                    const qty = parseInt(r.qty), price = parseFloat(r.price);
                    if (!(qty > 0) || isNaN(price)) return null;
                    // [取低者] 批发档位价 与 会员折扣价 取低，先比未取整值再取两位小数
                    return { qty, price: Math.round(Math.min(price, memberRaw) * 100) / 100 };
                }).filter(Boolean);
            }
        }
    }
}

// === [v1] 会员等级：自动升级统一入口 ===
// 判定口径：total_incoming（累计入金 = 自助充值 + 管理员手动加余额）
// 优先级规则（最高优先级：管理员手动设定）：
//   - level_source='manual'（管理员手动设过）→ 自动规则【绝不】写 member_level，只更新 auto_level 供查看
//   - level_source='auto'                      → 自动规则可写 member_level，但只升不降
// 返回当前生效等级（失败返回 null）
async function applyAutoUpgrade(db, userId) {
    try {
        const rulesRow = await db.prepare("SELECT value FROM site_config WHERE key='member_upgrade_rules'").first();
        if (!rulesRow || !rulesRow.value) return null;
        let rules;
        try { rules = JSON.parse(rulesRow.value); } catch (e) { return null; }
        if (!Array.isArray(rules) || rules.length === 0) return null;

        const u = await db.prepare('SELECT member_level, auto_level, level_source, total_incoming FROM users WHERE id=?').bind(userId).first();
        if (!u) return null;

        // 按当前规则从零重算「应得等级」（不累加，规则调整后下次调用立即生效）
        const incoming = parseFloat(u.total_incoming) || 0;
        let auto = 0;
        for (const r of rules) {
            const amt = parseFloat(r.amount), lv = parseInt(r.level);
            if (!isNaN(amt) && !isNaN(lv) && incoming >= amt && lv > auto) auto = lv;
        }

        const isManual = u.level_source === 'manual';
        const cur = parseInt(u.member_level) || 0;
        // 自动模式：同步 member_level（只升不降）；手动模式：member_level 一字不改
        const next = isManual ? cur : Math.max(cur, auto);

        await db.prepare('UPDATE users SET auto_level=?, member_level=?, updated_at=? WHERE id=?')
            .bind(auto, next, time(), userId).run();
        return next;
    } catch (e) {
        console.error('applyAutoUpgrade failed:', e);
        return null;
    }
}

// === [v1] 等级配置校验：只允许 member_levels 里已配置的等级 ===
// 防止管理员设成 V9 而 member_levels 只配到 V5，导致 resolveMemberDiscount 静默返回 100（无折扣）。
// 返回 {ok:true, levels:[...]} 或 {ok:false, error:'...'}
async function validateMemberLevel(db, level) {
    const lv = parseInt(level);
    if (isNaN(lv) || lv < 0) return { ok: false, error: '等级必须是不小于 0 的整数' };
    try {
        const row = await db.prepare("SELECT value FROM site_config WHERE key='member_levels'").first();
        if (!row || !row.value) return { ok: true, levels: [], note: '未配置会员等级体系，允许任意等级' };
        const levels = JSON.parse(row.value);
        if (!levels || typeof levels !== 'object') return { ok: true, levels: [] };
        const allowed = Object.keys(levels).map(n => parseInt(n)).filter(n => !isNaN(n)).sort((a, b) => a - b);
        if (allowed.length === 0) return { ok: true, levels: [] };
        if (!allowed.includes(lv)) {
            return { ok: false, error: '等级 ' + lv + ' 未在会员等级体系中配置（可选：' + allowed.join(', ') + '），否则该会员将按无折扣计价' };
        }
        return { ok: true, levels: allowed };
    } catch (e) {
        return { ok: true, levels: [] }; // 校验失败不阻断业务
    }
}

// ===================== [v3] MD5 (RFC 1321) =====================
// Web Crypto 不提供 MD5，但 dujiao-next 的 body hash 与 acg-faka 的签名都要求 MD5。
// 已用 RFC 1321 全部 7 个标准测试向量验证，并经 Python hashlib 交叉确认。
const _md5K = (() => { const K = new Uint32Array(64); for (let i = 0; i < 64; i++) K[i] = (Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0; return K; })();
const _md5S = [7,12,17,22, 7,12,17,22, 7,12,17,22, 7,12,17,22,
               5, 9,14,20, 5, 9,14,20, 5, 9,14,20, 5, 9,14,20,
               4,11,16,23, 4,11,16,23, 4,11,16,23, 4,11,16,23,
               6,10,15,21, 6,10,15,21, 6,10,15,21, 6,10,15,21];
function md5Bytes(buf) {
    const ml = buf.length;
    const total = ((((ml + 8) >> 6) + 1) << 6);
    const padded = new Uint8Array(total);
    padded.set(buf);
    padded[ml] = 0x80;
    const bitLen = ml * 8;
    const dv = new DataView(padded.buffer);
    dv.setUint32(total - 8, bitLen >>> 0, true);
    dv.setUint32(total - 4, Math.floor(bitLen / 4294967296) >>> 0, true);
    let a = 0x67452301, b = 0xefcdab89, c = 0x98badcfe, d = 0x10325476;
    const M = new Uint32Array(16);
    for (let off = 0; off < total; off += 64) {
        for (let i = 0; i < 16; i++) M[i] = dv.getUint32(off + i * 4, true);
        let A = a, B = b, C = c, D = d;
        for (let i = 0; i < 64; i++) {
            let F, g;
            if (i < 16)      { F = (B & C) | (~B & D);   g = i; }
            else if (i < 32) { F = (D & B) | (~D & C);   g = (5 * i + 1) % 16; }
            else if (i < 48) { F = B ^ C ^ D;            g = (3 * i + 5) % 16; }
            else             { F = C ^ (B | ~D);         g = (7 * i) % 16; }
            F = (F + A + _md5K[i] + M[g]) >>> 0;
            A = D; D = C; C = B;
            B = (B + ((F << _md5S[i]) | (F >>> (32 - _md5S[i])))) >>> 0;
        }
        a = (a + A) >>> 0; b = (b + B) >>> 0; c = (c + C) >>> 0; d = (d + D) >>> 0;
    }
    const out = new Uint8Array(16);
    const odv = new DataView(out.buffer);
    odv.setUint32(0, a, true); odv.setUint32(4, b, true);
    odv.setUint32(8, c, true); odv.setUint32(12, d, true);
    return out;
}
const md5Hex = (input) => {
    const bytes = (typeof input === 'string') ? new TextEncoder().encode(input) : input;
    return Array.from(md5Bytes(bytes)).map(x => x.toString(16).padStart(2, '0')).join('');
};
// ===================== END MD5 =====================

// [v3] 上游连接表（采购方侧配置）
let _upstreamConnEnsured = false;
async function ensureUpstreamConnTable(db) {
    if (_upstreamConnEnsured) return;
    try {
        await db.prepare(`CREATE TABLE IF NOT EXISTS upstream_connections (
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
        )`).run();
        // [v3+] 上游 SKU ↔ 本地规格 映射（sync 建立，purchase 自动补货用）
        await db.prepare(`CREATE TABLE IF NOT EXISTS upstream_items (
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
        )`).run();
    } catch(e) {}
    _upstreamConnEnsured = true;
}

// [v3] 递归深度守卫：防止 A→B→A→B 无限循环把额度/库存/余额全部烧光。
// 所有会触发「向下游发货 / 向下游回调」的出站调用都应带 X-XYFK-Chain-Depth 并递增。
const CHAIN_DEPTH_LIMIT = 3;
function chainDepth(request) {
    const v = parseInt(request.headers.get('X-XYFK-Chain-Depth') || '0');
    return isNaN(v) ? 0 : v;
}

// [v3+] 采购方客户端：dujiao-next 协议出站签名调用封装（HMAC-SHA256）
//   sign_string = "{METHOD}\n{path}\n{timestamp}\n{md5hex(body)}"，path 不含 query string。
// 返回 { status, ok, data }。带上 X-XYFK-Chain-Depth 递增，配合上游的递归深度守卫。
async function upstreamSignedFetch(conn, method, apiPath, bodyObj) {
    const ts = time();
    const bodyText = bodyObj ? JSON.stringify(bodyObj) : '';
    const pathOnly = String(apiPath).split('?')[0];       // ⚠️ 签名不含 query string
    const signStr = String(method).toUpperCase() + '\n' + pathOnly + '\n' + ts + '\n' + md5Hex(bodyText);
    const sig = await hmacSha256Hex(String(conn.api_secret || ''), signStr);
    const url = String(conn.base_url || '').replace(/\/+$/, '') + apiPath;
    let depth = 0;
    try { depth = parseInt(conn._chain_depth) || 0; } catch (e) {}
    const resp = await fetch(url, {
        method: String(method).toUpperCase(),
        headers: Object.assign({
            'Dujiao-Next-Api-Key': String(conn.api_key || ''),
            'Dujiao-Next-Timestamp': String(ts),
            'Dujiao-Next-Signature': sig,
            'X-XYFK-Chain-Depth': String(depth + 1)
        }, bodyObj ? { 'Content-Type': 'application/json' } : {}),
        body: bodyObj ? bodyText : undefined
    });
    let data = null;
    try { data = await resp.json(); } catch (e) {}
    return { status: resp.status, ok: resp.ok, data };
}

// ===================== [v3] dujiao-next 上游供货协议 =====================
// 协议来源：dujiao-next 内部/upstream/signer.go 与 internal/modules/upstreamapi/transport/http/
// 严格 1:1 复刻，任何 dujiao-next 实例都能把本站当上游供货商。
// 签名：HMAC-SHA256(secret, "{method}\n{path}\n{timestamp}\n{md5hex(body)}")
//       path 【不含】query string；空 body 的 md5 = d41d8cd98f00b204e9800998ecf8427e
const hmacMd5Sign = async (secret, method, path, ts, bodyStr) => {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const msg = `${method}\n${path}\n${ts}\n${md5Hex(bodyStr)}`;
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
    return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
};

// dujiao-next 风格错误响应
const upErr = (status, code, message) => jsonRes({ ok: false, error_code: code, error_message: message }, status);

// dujiao-next 鉴权（header 名与容差均与上游协议一致）
async function upstreamAuth(request, env, db) {
    await ensureApiTables(db);
    const h = request.headers;
    const apiKey = h.get('Dujiao-Next-Api-Key') || '';
    const tsStr = h.get('Dujiao-Next-Timestamp') || '';
    const sig = h.get('Dujiao-Next-Signature') || '';
    if (!apiKey || !tsStr || !sig) return { ok: false, status: 401, code: 'missing_auth_headers', msg: 'missing authentication headers' };
    const ts = parseInt(tsStr, 10);
    if (isNaN(ts)) return { ok: false, status: 401, code: 'invalid_timestamp', msg: 'invalid timestamp' };
    if (Math.abs(time() - ts) > 60) return { ok: false, status: 401, code: 'timestamp_expired', msg: 'timestamp expired' };

    const cred = await db.prepare('SELECT * FROM api_credentials WHERE api_key=?').bind(apiKey).first();
    if (!cred || cred.status !== 'approved' || cred.is_active !== 1) {
        return { ok: false, status: 403, code: 'invalid_api_key', msg: 'api key is invalid or disabled' };
    }
    const user = await db.prepare('SELECT id, username, email, balance, frozen, member_level, total_incoming FROM users WHERE id=?').bind(cred.user_id).first();
    if (!user) return { ok: false, status: 403, code: 'invalid_api_key', msg: 'api key is invalid or disabled' };
    if (user.frozen === 1) return { ok: false, status: 403, code: 'user_disabled', msg: 'user account is disabled' };

    const signPath = new URL(request.url).pathname;   // 不含 query
    let bodyStr = '';
    try { bodyStr = await request.clone().text(); } catch(e) { bodyStr = ''; }
    const expect = await hmacMd5Sign(cred.api_secret, request.method, signPath, ts, bodyStr);
    if (!timingSafeEqual(expect, (sig || '').toLowerCase())) {
        return { ok: false, status: 401, code: 'invalid_signature', msg: 'signature verification failed' };
    }
    const rl = await checkRateLimit(db, 'up_' + apiKey, parseInt(cred.rate_limit_per_min) || 60, 60);
    if (!rl.ok) return { ok: false, status: 429, code: 'rate_limited', msg: 'too many requests' };
    return { ok: true, user, cred };
}

// 协议里的多语言 JSON 字段（jsonmap.JSON），中文站统一回 zh_CN
const jsonmap = (s) => ({ zh_CN: String(s == null ? '' : s) });

// ===================== [v3] acg-faka「对接店铺/上游货源」协议 =====================
// 协议来源：acg-faka app/Util/Str.php generateSignature + app/Interceptor/SharedValidation.php
// 签名（易支付风格 MD5）：
//   unset(sign) → ksort → 移除空串 → http_build_query(data) + "&key=" + appKey → urldecode → md5
// ⚠️ urlencode+urldecode 是恒等变换，故可直接用原始 key=value 以 & 连接。
// 封套：{ code: 200, msg: 'success', data: {...} }
const acgSign = (data, appKey) => {
    const d = Object.assign({}, data);
    delete d.sign;
    const keys = Object.keys(d).filter(k => d[k] !== '' && d[k] !== null && d[k] !== undefined).sort();
    const s = keys.map(k => k + '=' + String(d[k])).join('&') + '&key=' + String(appKey);
    return md5Hex(s);
};
const acgOk = (data, msg) => jsonRes({ code: 200, msg: msg || 'success', data: data || {} });
const acgErr = (msg, code) => jsonRes({ code: code || 400, msg: String(msg || 'error'), data: null });

// acg-faka 商品「种类」(race) key：必须 INI 语法安全。
// acg-faka 的 Ini::toArray 是自研解析器：按行拆、[结尾...]$ 当节点、按第一个 = 拆键值、
// 键里的 . 表嵌套、值里再出现 = 直接抛异常。故 . = [ ] 换行全部替换掉。
const acgRaceBaseKey = (v) => {
    const s = String(v.name || '').replace(/[.=\[\]\r\n]/g, '_').trim();
    return s || ('v' + v.id);
};
// 规格列表 → Map(variantId → raceKey)；重名时后者加 _id 后缀，保证唯一且双方可复算
const acgRaceKeyMap = (vars) => {
    const map = new Map();
    const used = new Set();
    for (const v of (vars || [])) {
        let k = acgRaceBaseKey(v);
        if (used.has(k)) k = k + '_' + v.id;
        used.add(k);
        map.set(v.id, k);
    }
    return map;
};
// race → 规格：空 = 第一个；兼容 raceKey / 原始名称 / 规格 id 三种写法
const acgRacePick = (vars, keyMap, race) => {
    const list = vars || [];
    const r = String(race || '').trim();
    if (!r) return list[0] || null;
    return list.find(v => keyMap.get(v.id) === r)
        || list.find(v => String(v.name || '') === r)
        || list.find(v => String(v.id) === r)
        || null;
};
// config INI 文本（对齐 acg-faka Ini::toConfig 输出格式：[section] + key=value，无引号）
// entries: [{key, id, listPrice, unitPrice}]；单规格商品不出 config（走 factory_price 口径）
const acgBuildConfigIni = (entries) => {
    if (!entries || entries.length <= 1) return '';
    const cat = [], map = [], fac = [];
    for (const e of entries) {
        cat.push(e.key + '=' + e.listPrice);
        map.push(e.key + '=' + e.id);
        fac.push(e.key + '=' + e.unitPrice);
    }
    return '[category]\n' + cat.join('\n') + '\n[shared_mapping]\n' + map.join('\n') + '\n[category_factory]\n' + fac.join('\n');
};

// 解析 x-www-form-urlencoded（保留原始字符串值，与 PHP $_POST 一致）
async function parseFormBody(request) {
    let text = '';
    try { text = await request.clone().text(); } catch(e) { return {}; }
    const out = {};
    if (!text) return out;
    try {
        const sp = new URLSearchParams(text);
        for (const [k, v] of sp.entries()) out[k] = v;
    } catch(e) {}
    return out;
}

// acg-faka 鉴权：app_id = 本站会员ID；app_key = 该会员的 api_secret（兼作签名密钥）
async function acgAuth(request, db, form) {
    await ensureApiTables(db);
    const appId = parseInt(form.app_id);
    if (!appId) return { ok: false, msg: '商户ID不存在' };
    const cred = await db.prepare('SELECT * FROM api_credentials WHERE user_id=?').bind(appId).first();
    if (!cred) return { ok: false, msg: '商户ID不存在' };
    if (cred.status !== 'approved' || cred.is_active !== 1) return { ok: false, msg: '密钥错误' };
    const providedKey = String(form.app_key || '');
    if (!providedKey || !timingSafeEqual(providedKey, String(cred.api_secret))) return { ok: false, msg: '密钥错误' };
    const sign = String(form.sign || '');
    if (!sign || !timingSafeEqual(acgSign(form, providedKey), sign)) return { ok: false, msg: '密钥错误' };
    const user = await db.prepare('SELECT id, username, email, balance, frozen, member_level, total_incoming FROM users WHERE id=?').bind(appId).first();
    if (!user) return { ok: false, msg: '商户ID不存在' };
    if (user.frozen === 1) return { ok: false, msg: '账户已被冻结' };
    const rl = await checkRateLimit(db, 'acg_' + cred.api_key, parseInt(cred.rate_limit_per_min) || 60, 60);
    if (!rl.ok) return { ok: false, msg: '请求过于频繁' };
    return { ok: true, user, cred };
}

// ===================== [v2] 开放 API 基础设施 =====================

// 建表：API 凭证 / 幂等引用 / 调用审计；并给 products、orders 补列
let _apiSchemaEnsured = false;
async function ensureApiTables(db) {
    if (_apiSchemaEnsured) return;
    for (const ddl of [
        // API 凭证：一个会员一把 key（user_id UNIQUE）
        `CREATE TABLE IF NOT EXISTS api_credentials (
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
        )`,
        // 下游订单幂等 + 回调状态
        `CREATE TABLE IF NOT EXISTS api_order_refs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            credential_id INTEGER NOT NULL,
            order_id TEXT NOT NULL,
            downstream_order_no TEXT,
            trace_id TEXT,
            callback_url TEXT,
            callback_status TEXT DEFAULT 'pending',
            callback_attempts INTEGER DEFAULT 0,
            created_at INTEGER
        )`,
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_aor_cred_downstream ON api_order_refs(credential_id, downstream_order_no)',
        'CREATE INDEX IF NOT EXISTS idx_aor_order_id ON api_order_refs(order_id)',
        // 调用审计
        `CREATE TABLE IF NOT EXISTS api_call_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            credential_id INTEGER,
            user_id INTEGER,
            method TEXT,
            path TEXT,
            status_code INTEGER,
            error_code TEXT,
            ip TEXT,
            created_at INTEGER
        )`,
        'CREATE INDEX IF NOT EXISTS idx_acl_user ON api_call_logs(user_id, created_at)',
        // [修复] dashboard 额度告警需按时间全局聚合，否则 api_call_logs 增长后逐行全表扫描
        'CREATE INDEX IF NOT EXISTS idx_acl_created ON api_call_logs(created_at)',
        'CREATE INDEX IF NOT EXISTS idx_acl_error ON api_call_logs(created_at, error_code)',
        // 商品：是否允许被 API 调用购买
        'ALTER TABLE products ADD COLUMN api_enabled INTEGER DEFAULT 0',
        // 商品：最后变更时间（增量同步 / updated_after 用）
        // [修复] 改由 ensureProductColumns 统一处理（含 variants/categories 及联动触发器）
        // 订单类型：shop=零售 / recharge=充值 / api=API采购（避免靠商品名字符串区分）
        "ALTER TABLE orders ADD COLUMN order_type TEXT DEFAULT 'shop'",
        // 卡密渠道溯源
        'ALTER TABLE cards ADD COLUMN api_ref_id INTEGER',
        // [v3+] 权限范围（空 = 全部开放，兼容存量 key）
        "ALTER TABLE api_credentials ADD COLUMN scopes TEXT DEFAULT ''"
    ]) {
        try { await db.prepare(ddl).run(); } catch(e) {}
    }
    // [修复] 开放 API 路径也要保证商品/规格表结构与联动触发器就绪，
    //        否则 updated_after 过滤会因缺 updated_at 列而静默失效。
    await ensureProductColumns(db);
    _apiSchemaEnsured = true;
}

// API Key / Secret 生成（CSPRNG）
const genHex = (bytes) => Array.from(crypto.getRandomValues(new Uint8Array(bytes))).map(b => b.toString(16).padStart(2, '0')).join('');
const genApiKey = () => genHex(16);     // 32 hex
const genApiSecret = () => genHex(32);  // 64 hex

// (已移除重复的 sha256Hex 定义，复用上方的 async function sha256Hex)

// HMAC-SHA256 签名（开放 API 严格模式）
// sign_string = "{method}\n{path}\n{timestamp}\n{sha256hex(body)}"
const hmacSign = async (secret, method, path, ts, bodyStr) => {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const msg = `${method}\n${path}\n${ts}\n${await sha256Hex(bodyStr)}`;
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
    return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
};

// 恒定时间字符串比较（防时序侧信道）
const timingSafeEqual = (a, b) => {
    if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
};

// ===================== [v3+] 出站回调投递（dujiao-next 协议出站端） =====================
// 协议：POST {callback_url}，path 固定按 /api/v1/upstream/callback 签名
//   sign_string = "POST\n/api/v1/upstream/callback\n{timestamp}\n{md5hex(body)}"
//   signature   = hex(HMAC-SHA256(api_secret, sign_string))
// 失败按 callback_attempts 退避重试 3 次（立即 / 1s / 2s），状态写回 api_order_refs。
const CALLBACK_SIGN_PATH = '/api/v1/upstream/callback';
const CALLBACK_MAX_ATTEMPTS = 3;
const CALLBACK_BACKOFF_MS = [0, 1000, 2000];

async function hmacSha256Hex(secret, msg) {
    const key = await crypto.subtle.importKey(
        'raw', new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
    return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// 出站回调签名（与 upstreamAuth 验签算法 1:1 对应）
async function signCallback(secret, ts, bodyText) {
    const signStr = 'POST\n' + CALLBACK_SIGN_PATH + '\n' + ts + '\n' + md5Hex(bodyText || '');
    return hmacSha256Hex(secret, signStr);
}

// 统一回调载荷（dujiao-next 出站事件）
function buildApiCallbackPayload(event, info) {
    return {
        event,                                   // order.delivered | order.canceled
        protocol_version: '1.0',
        order_id: info.refId,                    // api_order_refs.id（协议 uint）
        order_no: info.orderNo,                  // 本站订单 uuid
        downstream_order_no: info.downstreamOrderNo || null,
        trace_id: info.traceId || null,
        status: info.status,                     // delivered | canceled | paid
        amount: info.amount || '0.00',
        currency: 'CNY',
        fulfillment: info.cards && info.cards.length
            ? { payload: info.cards.join('\n'), delivered_at: info.deliveredAt || time() }
            : null,
        timestamp: time()
    };
}

// 单次投递（10s 超时）；返回 true=成功
async function postCallbackOnce(cred, url, bodyText, ts, sig) {
    const ctrl = (typeof AbortSignal !== 'undefined' && AbortSignal.timeout)
        ? AbortSignal.timeout(10000) : undefined;
    try {
        const resp = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Dujiao-Next-Api-Key': String(cred.api_key || ''),
                'Dujiao-Next-Timestamp': String(ts),
                'Dujiao-Next-Signature': sig
            },
            body: bodyText,
            signal: ctrl
        });
        return resp && resp.ok;
    } catch (e) {
        return false;
    }
}

// 后台投递 + 3 次退避重试；调用方用 ctx.waitUntil() 包住，不阻塞主响应
async function deliverApiCallback(db, cred, refId, callbackUrl, payload) {
    if (!callbackUrl || !refId) return false;
    if (cred && cred.allow_callback === 0) {
        try { await db.prepare("UPDATE api_order_refs SET callback_status='skipped' WHERE id=?").bind(refId).run(); } catch (e) {}
        return false;
    }
    const bodyText = JSON.stringify(payload);
    for (let attempt = 0; attempt < CALLBACK_MAX_ATTEMPTS; attempt++) {
        if (CALLBACK_BACKOFF_MS[attempt] > 0) {
            await new Promise(r => setTimeout(r, CALLBACK_BACKOFF_MS[attempt]));
        }
        const ts = time();
        let sig = '';
        try { sig = await signCallback(cred.api_secret, ts, bodyText); } catch (e) { break; }
        const ok = await postCallbackOnce(cred, callbackUrl, bodyText, ts, sig);
        try {
            await db.prepare('UPDATE api_order_refs SET callback_status=?, callback_attempts=? WHERE id=?')
                .bind(ok ? 'sent' : 'failed', attempt + 1, refId).run();
        } catch (e) {}
        if (ok) return true;
    }
    return false;
}

// ===================== [v3+] scopes 权限范围（可选；空 = 全部开放，兼容存量 key） =====================
// 支持 JSON 数组 '["catalog:read","order:write"]' 或逗号分隔字符串；'*' = 全部。
function scopeAllows(cred, method, path) {
    const raw = (cred && cred.scopes) ? String(cred.scopes).trim() : '';
    if (!raw) return true;
    let list;
    try { list = JSON.parse(raw); } catch (e) { list = raw.split(/[\s,]+/).filter(Boolean); }
    if (!Array.isArray(list) || !list.length) return true;
    if (list.includes('*')) return true;
    let need = 'catalog:read';
    if ((/\/orders$/.test(path) || /\/order\/create/.test(path)) && method === 'POST') need = 'order:write';
    else if (/\/orders\//.test(path) || /\/order\/(query|cancel)/.test(path) || /\/balance$/.test(path)) need = 'order:read';
    return list.includes(need);
}

// ===================== [v3+] 60s 边缘缓存（防下游高频轮询烧穿 D1 额度） =====================
// 注意：商品响应含调用方会员计价，缓存 key 必须带上 api_key 隔离，否则会串价。
const EDGE_CACHE_TTL_LIST = 60;   // 商品列表 60s（含内嵌库存字段）
function edgeCacheReq(url, apiKey) {
    try {
        return new Request(url.origin + url.pathname + url.search + '&__ck=' + encodeURIComponent(apiKey), { method: 'GET' });
    } catch (e) { return null; }
}
async function edgeCacheMatch(reqKey) {
    if (!reqKey) return null;
    try {
        if (typeof caches === 'undefined' || !caches.default) return null;
        return await caches.default.match(reqKey) || null;
    } catch (e) { return null; }
}
async function edgeCachePut(reqKey, resp, ttl) {
    if (!reqKey || !resp || resp.status !== 200) return;
    try {
        if (typeof caches === 'undefined' || !caches.default) return;
        const copy = resp.clone();
        const stored = new Response(copy.body, { status: copy.status, headers: copy.headers });
        stored.headers.set('Cache-Control', 'public, max-age=' + ttl);
        stored.headers.delete('Set-Cookie');
        await caches.default.put(reqKey, stored);
    } catch (e) {}
}

// 频率限制（复用 rate_limits 表）：固定窗口
async function checkRateLimit(db, key, limit, windowSec) {
    if (!limit || limit <= 0) return { ok: true };
    const now = time();
    try { await db.prepare('CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, count INTEGER DEFAULT 1, first_attempt INTEGER NOT NULL)').run(); } catch(e) {}
    const row = await db.prepare('SELECT count, first_attempt FROM rate_limits WHERE key=?').bind(key).first();
    if (!row || (now - row.first_attempt) > windowSec) {
        await db.prepare('INSERT INTO rate_limits (key, count, first_attempt) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count=1, first_attempt=excluded.first_attempt')
            .bind(key, now).run();
        return { ok: true };
    }
    if (row.count >= limit) {
        const retry = Math.max(1, windowSec - (now - row.first_attempt));
        return { ok: false, retry_after: retry };
    }
    await db.prepare('UPDATE rate_limits SET count=count+1 WHERE key=?').bind(key).run();
    return { ok: true };
}

// 开放 API 统一响应封套（兼容主流发卡平台调用习惯）
const openOk = (data) => jsonRes({ code: 200, msg: 'ok', data: data || {} });
const openErr = (code, msg, extra) => jsonRes(Object.assign({ code, msg, data: null }, extra || {}), code);

// [v2] 开放 API 鉴权：双模式
//   简单模式：Authorization: Bearer <api_key>（或 X-Api-Key）
//   严格模式：X-Api-Key + X-Api-Timestamp + X-Api-Signature（HMAC-SHA256，防重放）
// 返回 {ok:true, user, cred} 或 {ok:false, code, msg}
async function apiAuth(request, env, db, pathForSign) {
    await ensureApiTables(db);
    const h = request.headers;
    let apiKey = h.get('X-Api-Key') || '';
    const auth = h.get('Authorization') || '';
    if (!apiKey && auth.startsWith('Bearer ')) apiKey = auth.substring(7).trim();
    if (!apiKey) return { ok: false, code: 401, msg: '缺少 API Key（请用 Authorization: Bearer <key> 或 X-Api-Key 头）' };

    const cred = await db.prepare('SELECT * FROM api_credentials WHERE api_key=?').bind(apiKey).first();
    if (!cred) return { ok: false, code: 401, msg: 'API Key 不存在' };
    if (cred.status !== 'approved' || cred.is_active !== 1) {
        return { ok: false, code: 403, msg: 'API Key 已被禁用或未通过审核' };
    }

    // 严格模式：验签 + 时间戳（±60秒）
    const ts = h.get('X-Api-Timestamp');
    const sig = h.get('X-Api-Signature');
    if (ts || sig) {
        if (!ts || !sig) return { ok: false, code: 401, msg: '签名校验需要同时提供 X-Api-Timestamp 与 X-Api-Signature' };
        const t = parseInt(ts, 10);
        if (isNaN(t)) return { ok: false, code: 401, msg: '时间戳格式不正确' };
        if (Math.abs(time() - t) > 60) return { ok: false, code: 401, msg: '时间戳已过期（允许偏差 ±60 秒）' };
        let bodyStr = '';
        try { bodyStr = await request.clone().text(); } catch(e) { bodyStr = ''; }
        const expect = await hmacSign(cred.api_secret, request.method, pathForSign, t, bodyStr);
        if (!timingSafeEqual(expect, (sig || '').toLowerCase())) {
            return { ok: false, code: 401, msg: '签名校验失败' };
        }
    }

    const user = await db.prepare('SELECT id, username, email, balance, frozen, member_level, total_incoming FROM users WHERE id=?').bind(cred.user_id).first();
    if (!user) return { ok: false, code: 403, msg: '会员不存在' };
    if (user.frozen === 1) return { ok: false, code: 403, msg: '会员账户已被冻结' };

    // 限流（每分钟）
    const rl = await checkRateLimit(db, 'api_' + apiKey, parseInt(cred.rate_limit_per_min) || 60, 60);
    if (!rl.ok) return { ok: false, code: 429, msg: '请求过于频繁，请稍后重试', retry_after: rl.retry_after };

    return { ok: true, user, cred };
}

// [v2] API 计价：price_mode 决定口径
//   member（默认）   = 会员折扣价，与前台会员价同一口径（含「与批发价取低者」规则）
//   fixed_member     = 固定会员价：忽略批发档位，单价仅由会员折扣决定、与数量无关（对接平台/下游供货推荐）
//   list             = 挂牌价，不打折
// preDiscount（可选）= 预解析好的会员折扣（1..100），批量报价时传入可省去逐 SKU 查库
async function apiUnitPrice(db, auth, variant, product, quantity, preDiscount) {
    const base = parseFloat(variant.price) || 0;
    let listPrice = base;
    // 批发档位（与下单主逻辑同口径：按 qty 降序命中）
    if (variant.wholesale_config) {
        let wc = variant.wholesale_config;
        try { if (typeof wc === 'string') wc = JSON.parse(wc); } catch(e) { wc = null; }
        if (Array.isArray(wc)) {
            const sorted = wc.slice().sort((a, b) => (parseInt(b.qty) || 0) - (parseInt(a.qty) || 0));
            for (const rule of sorted) {
                const q = parseInt(rule.qty);
                if (q > 0 && quantity >= q) { listPrice = parseFloat(rule.price) || listPrice; break; }
            }
        }
    }
    const priceMode = (auth.cred && auth.cred.price_mode) || 'member';
    if (priceMode === 'list') return Math.round(listPrice * 100) / 100;
    const discount = (preDiscount === undefined || preDiscount === null)
        ? await resolveMemberDiscount(db, auth.user.member_level) : preDiscount;
    const priceOn = !product || product.member_price_enabled !== 0;
    // fixed_member = 固定会员价：不看批发档，单价与数量无关，便于下游成本同步/对账恒等
    if (priceMode === 'fixed_member') {
        if (discount < 100 && priceOn) return Math.round((base * discount / 100) * 100) / 100;
        return Math.round(base * 100) / 100;
    }
    if (discount < 100 && priceOn) {
        return Math.round(Math.min(listPrice, base * discount / 100) * 100) / 100;
    }
    return Math.round(listPrice * 100) / 100;
}

// [v2] 审计日志（失败也记，便于排查）
async function logApiCall(db, auth, request, status, errCode) {
    try {
        await db.prepare('INSERT INTO api_call_logs (credential_id, user_id, method, path, status_code, error_code, ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
            .bind(auth && auth.cred ? auth.cred.id : null, auth && auth.user ? auth.user.id : null,
                request.method, new URL(request.url).pathname, status, errCode || null, getClientIP(request), time()).run();
    } catch(e) {}
}

async function handleApi(request, env, url, ctx) {
    const method = request.method;
    const path = url.pathname;
    const db = env.xyfk; // 数据库绑定

    try {
        // [新增] 会员相关请求先确保表结构完整（旧库缺表/缺列会导致 500）
        if (path.startsWith('/api/member') || path.startsWith('/api/admin/member') || path === '/api/admin/members/list') {
            await ensureMemberTables(db);
        }
        // [新增] 商品/下单相关请求先确保商品表结构完整（旧库缺 member_price_enabled 列会导致 500）
        // [修复] 分类/卡密同样会写 updated_at 或联动推高 products.updated_at，一并纳入
        if (path.startsWith('/api/admin/product') || path.startsWith('/api/shop/product')
            || path === '/api/shop/order/create' || path === '/api/shop/cart/checkout'
            || path.startsWith('/api/admin/category') || path === '/api/shop/categories'
            || path.startsWith('/api/admin/card') || path.startsWith('/api/admin/cards')
            || path.startsWith('/api/admin/upstream') || path.startsWith('/api/v1/upstream')
            || path.startsWith('/api/open/v1') || path.startsWith('/shared/')) {
            await ensureProductColumns(db);
        }
        // ===========================
        // --- [v3] acg-faka 对接店铺协议 /shared/* ---
        // ===========================
        // 契约按 acg-faka 3.1.2 源码逐项对齐（服务器端 app/Controller/Shared/Commodity.php
        // + 客户端 app/Service/Bind/Shared.php + 字段白名单 app/Util/SharedPayload.php）：
        //   - 商品行 = COMMODITY_FIELDS（name/description/cover/price/user_price/config/stock/...）
        //   - 列表 = 分类树 [{id,name,sort,icon,status,pid,children:[商品行]}]（CATEGORY_FIELDS）
        //   - config = INI 文本（category=挂牌价 / shared_mapping=规格id / category_factory=拿货价）
        //   - delivery_way：0=卡密库存(自动发卡)，1=人工
        //   - trade / query 的 data.secret = 卡密文本（下游直接当发货内容，最关键字段）
        //   - 失败 = code != 200（acg-faka 抛 JSONException 时 code=0，客户端只看是否 200）
        //   - HTTP 恒 200：客户端 postOptional 把 404/405 当「老版本上游」，绝不能回这两个状态码
        if (path.startsWith('/shared/')) {
            const form = await parseFormBody(request);
            const aa = await acgAuth(request, db, form);
            if (!aa.ok) { await logApiCall(db, null, request, 200, 'acg_auth_failed'); return acgErr(aa.msg); }
            const aUid = aa.user.id;
            // 会员折扣每请求解析一次（报价共用，避免逐 SKU 查库）
            const acgDiscount = await resolveMemberDiscount(db, aa.user.member_level);

            // 库存口径（自动发货=未售卡密数；手动发货=variants.stock）
            const acgStockOf = async (variant) => {
                if (variant.auto_delivery === 1) {
                    const r = await db.prepare('SELECT COUNT(*) as c FROM cards WHERE variant_id=? AND status=0').bind(variant.id).first();
                    return r ? (r.c || 0) : 0;
                }
                return parseInt(variant.stock) || 0;
            };
            // acg-faka 用 code 标识商品；这里用商品 id 的字符串形式
            const acgFindGoods = async (code) => {
                const pid = parseInt(code);
                if (!pid) return null;
                return await db.prepare('SELECT * FROM products WHERE id=? AND api_enabled=1 AND active=1').bind(pid).first() || null;
            };
            const acgVarsOf = async (p) =>
                (await db.prepare('SELECT * FROM variants WHERE product_id=? AND active=1 ORDER BY sort DESC, id ASC').bind(p.id).all()).results || [];
            // 拿货价（按调用方会员身份计价）
            const acgUnit = async (v, p, num) =>
                (await apiUnitPrice(db, aa, v, { member_price_enabled: p.member_price_enabled }, num || 1, acgDiscount));

            // 计价 + config 一次性算好：多规格出 category/shared_mapping/category_factory 三段，
            // 单规格不出 config（成本走 factory_price 口径，与 acg-faka 语义一致）
            const acgConfigAndPrice = async (p, vars) => {
                const keyMap = acgRaceKeyMap(vars);
                const units = [];
                for (const v of vars) units.push(await acgUnit(v, p, 1));
                const lists = vars.map(v => parseFloat(v.price) || 0);
                const entries = vars.map((v, i) => ({
                    key: keyMap.get(v.id),
                    id: v.id,
                    listPrice: (parseFloat(v.price) || 0).toFixed(2),
                    unitPrice: (units[i] || 0).toFixed(2)
                }));
                return {
                    keyMap,
                    ini: acgBuildConfigIni(entries),
                    isCategory: vars.length > 1,
                    // 多规格：factory_price=0，逐规格成本在 config.category_factory（与 acg-faka 同口径）
                    factory: vars.length > 1 ? 0 : (units[0] || 0),
                    listMin: vars.length ? Math.min(...lists) : 0,
                    unitMin: vars.length ? Math.min(...units) : 0
                };
            };
            // 商品行（COMMODITY_FIELDS 白名单口径）
            const acgRow = async (p, vars, info) => {
                let stock = 0;
                for (const v of vars) stock += await acgStockOf(v);
                return {
                    id: p.id,
                    category_id: p.category_id || 0,
                    name: p.name,
                    description: (p.description || '').replace(/<[^>]+>/g, ''),
                    cover: p.image_url || '',
                    price: info.listMin.toFixed(2),
                    user_price: info.unitMin.toFixed(2),
                    status: 1,
                    code: String(p.id),
                    sort: p.sort || 0,
                    delivery_way: (vars[0] && vars[0].auto_delivery === 1) ? 0 : 1,
                    contact_type: 0,
                    password_status: 0,
                    coupon: '',
                    seckill_status: 0,
                    seckill_start_time: '',
                    seckill_end_time: '',
                    draft_status: 1,
                    draft_premium: 0,
                    inventory_hidden: 0,
                    only_user: 0,
                    purchase_count: 0,
                    widget: '[]',
                    minimum: 0,
                    maximum: 0,
                    config: info.ini,
                    stock,
                    tags: p.tags || ''
                };
            };

            // ---- 1. 连接测试 ----
            if (path === '/shared/authentication/connect') {
                const s = await db.prepare("SELECT value FROM site_config WHERE key='site_name'").first();
                await logApiCall(db, aa, request, 200);
                return acgOk({ shopName: (s && s.value) || 'xyfk', balance: (parseFloat(aa.user.balance) || 0).toFixed(2) });
            }

            // ---- 2. 商品列表（分类树）----
            if (path === '/shared/commodity/items') {
                const rows = (await db.prepare('SELECT * FROM products WHERE api_enabled=1 AND active=1 ORDER BY sort DESC, id ASC').all()).results || [];
                const groups = new Map();
                for (const p of rows) {
                    const vars = await acgVarsOf(p);
                    if (!vars.length) continue;
                    const info = await acgConfigAndPrice(p, vars);
                    const cid = p.category_id || 0;
                    if (!groups.has(cid)) groups.set(cid, []);
                    groups.get(cid).push(await acgRow(p, vars, info));
                }
                const data = [];
                for (const [cid, children] of groups) {
                    const c = cid ? await db.prepare('SELECT * FROM categories WHERE id=?').bind(cid).first() : null;
                    data.push({
                        id: cid,
                        name: (c && c.name) || '未分类',
                        sort: (c && c.sort) || 0,
                        icon: (c && c.image_url) || '',
                        status: 1,
                        pid: 0,
                        children
                    });
                }
                await logApiCall(db, aa, request, 200);
                return acgOk(data);
            }

            // ---- 3. 商品详情（单商品对象；客户端以 name/price 字段识别「新协议」）----
            if (path === '/shared/commodity/item') {
                const p = await acgFindGoods(form.code || form.sharedCode);
                if (!p) { await logApiCall(db, aa, request, 200, 'acg_not_found'); return acgErr('商品不存在'); }
                const vars = await acgVarsOf(p);
                const info = await acgConfigAndPrice(p, vars);
                const row = await acgRow(p, vars, info);
                row.factory_price = info.factory.toFixed(2);
                await logApiCall(db, aa, request, 200);
                return acgOk(row);
            }

            // ---- 4. 库存 + 拿货价快照 ----
            if (path === '/shared/commodity/inventory') {
                const p = await acgFindGoods(form.sharedCode || form.code);
                if (!p) { await logApiCall(db, aa, request, 200, 'acg_not_found'); return acgErr('商品不存在'); }
                const vars = await acgVarsOf(p);
                const info = await acgConfigAndPrice(p, vars);
                const v = acgRacePick(vars, info.keyMap, form.race);
                let count = 0;
                if (v) count = await acgStockOf(v);
                else for (const x of vars) count += await acgStockOf(x);
                await logApiCall(db, aa, request, 200);
                return acgOk({
                    count,
                    delivery_way: (vars[0] && vars[0].auto_delivery === 1) ? 0 : 1,
                    draft_status: 1,
                    price: info.listMin.toFixed(2),
                    user_price: info.unitMin.toFixed(2),
                    config: info.ini,
                    factory_price: info.factory.toFixed(2),
                    is_category: info.isCategory
                });
            }

            // ---- 5. 库存状态（下单前检查）：足=200，不足=code!=200 报错 ----
            if (path === '/shared/commodity/inventoryState') {
                const p = await acgFindGoods(form.shared_code || form.code);
                if (!p) { await logApiCall(db, aa, request, 200, 'acg_not_found'); return acgErr('商品不存在'); }
                const vars = await acgVarsOf(p);
                const num = parseInt(form.num) || 1;
                const cardId = parseInt(form.card_id) || 0;
                if (cardId) {
                    const c = await db.prepare('SELECT id FROM cards WHERE id=? AND status=0 AND variant_id IN (SELECT id FROM variants WHERE product_id=?)')
                        .bind(cardId, p.id).first();
                    await logApiCall(db, aa, request, 200, c ? '' : 'acg_card_taken');
                    if (!c) return acgErr('该卡已被他人抢走啦');
                    return acgOk({});
                }
                const v = acgRacePick(vars, acgRaceKeyMap(vars), form.race);
                const stock = v ? await acgStockOf(v) : 0;
                await logApiCall(db, aa, request, 200);
                if (stock < num) return acgErr('库存不足');
                return acgOk({});
            }

            // ---- 6. 下单（data.secret = 卡密文本）----
            if (path === '/shared/commodity/trade') {
                const p = await acgFindGoods(form.shared_code || form.code);
                if (!p) { await logApiCall(db, aa, request, 200, 'acg_not_found'); return acgErr('商品不存在'); }
                const num = Math.max(1, Math.min(200, parseInt(form.num) || 1));
                const cardId = parseInt(form.card_id) || 0;
                const qty = cardId ? 1 : num; // 预选单卡时数量强制 1（与 acg-faka 一致）
                const requestNo = (form.request_no || '').toString().trim().substring(0, 64) || null;
                // 幂等：同一凭证 + 同一 request_no 回放已有订单（含 secret，不重复扣款）
                if (requestNo) {
                    const oldRef = await db.prepare('SELECT * FROM api_order_refs WHERE credential_id=? AND downstream_order_no=?').bind(aa.cred.id, requestNo).first();
                    if (oldRef) {
                        const old = await db.prepare('SELECT * FROM orders WHERE id=?').bind(oldRef.order_id).first();
                        if (old) {
                            const cr = (await db.prepare('SELECT content FROM cards WHERE order_id=? ORDER BY id ASC').bind(oldRef.order_id).all()).results || [];
                            await logApiCall(db, aa, request, 200, 'idempotent_hit');
                            return acgOk({ secret: cr.map(c => stripCardNote(c.content)).join('\n'), trade_no: old.id, amount: parseFloat(old.total_amount || 0).toFixed(2) });
                        }
                    }
                }
                const vars = await acgVarsOf(p);
                const v = acgRacePick(vars, acgRaceKeyMap(vars), form.race);
                if (!v) return acgErr('商品不存在');
                const stock = await acgStockOf(v);
                if (stock < qty) return acgErr('库存不足');
                const unit = await apiUnitPrice(db, aa, v, { member_price_enabled: p.member_price_enabled }, qty, acgDiscount);
                const total = Math.round(unit * qty * 100) / 100;
                if ((parseFloat(aa.user.balance) || 0) < total) return acgErr('余额不足');
                const orderId = uuid();
                const now = time();
                // 抢卡密（自动发货）：预选走指定卡，否则按数量抢
                let cards = [];
                if (v.auto_delivery === 1) {
                    if (cardId) {
                        const upd = await db.prepare('UPDATE cards SET status=1, order_id=? WHERE id=? AND status=0 AND variant_id=?').bind(orderId, cardId, v.id).run();
                        if (!upd.success || upd.meta.changes !== 1) return acgErr('该卡已被他人抢走啦');
                        cards = (await db.prepare('SELECT id, content FROM cards WHERE id=? AND order_id=?').bind(cardId, orderId).all()).results || [];
                    } else {
                        const cands = (await db.prepare('SELECT id FROM cards WHERE variant_id=? AND status=0 ORDER BY id ASC LIMIT ?').bind(v.id, qty).all()).results || [];
                        if (cands.length < qty) return acgErr('库存不足');
                        const ids = cands.map(c => c.id);
                        const ph = ids.map(() => '?').join(',');
                        await db.prepare(`UPDATE cards SET status=1, order_id=? WHERE id IN (${ph}) AND status=0`).bind(orderId, ...ids).run();
                        cards = (await db.prepare('SELECT id, content FROM cards WHERE order_id=? AND variant_id=? ORDER BY id ASC').bind(orderId, v.id).all()).results || [];
                        if (cards.length < qty) {
                            await db.prepare('UPDATE cards SET status=0, order_id=NULL WHERE order_id=? AND variant_id=?').bind(orderId, v.id).run();
                            return acgErr('库存竞争失败，请重试');
                        }
                    }
                }
                // 扣余额（条件 UPDATE 原子扣款）
                const dec = await db.prepare('UPDATE users SET balance = balance - ?, updated_at=? WHERE id=? AND balance >= ?').bind(total, now, aUid, total).run();
                if (!dec.success || dec.meta.changes !== 1) {
                    if (cards.length) await db.prepare('UPDATE cards SET status=0, order_id=NULL WHERE order_id=?').bind(orderId).run();
                    return acgErr('余额不足');
                }
                await db.prepare('INSERT INTO orders (id, trade_no, variant_id, product_name, variant_name, price, quantity, total_amount, contact, query_password, payment_method, created_at, status, cards_sent, user_id, order_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
                    .bind(orderId, requestNo, v.id, p.name, v.name, unit, qty, total.toFixed(2),
                        (form.contact || aa.user.email || aa.user.username || '').toString().substring(0, 100),
                        'api_' + aa.cred.id, 'balance', now, 1,
                        cards.length ? JSON.stringify(cards.map(c => ({ id: c.id, content: c.content }))) : null, aUid, 'api').run();
                await db.prepare('INSERT INTO balance_transactions (user_id, amount, type, description, order_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
                    .bind(aUid, -total, 'api_purchase', 'acg 采购 ' + p.name + ' x' + qty, orderId, now).run();
                await db.prepare('INSERT INTO api_order_refs (credential_id, order_id, downstream_order_no, callback_status, created_at) VALUES (?, ?, ?, ?, ?)')
                    .bind(aa.cred.id, orderId, requestNo, 'none', now).run();
                await logApiCall(db, aa, request, 200);
                return acgOk({ secret: cards.map(c => stripCardNote(c.content)).join('\n'), trade_no: orderId, amount: total.toFixed(2) });
            }

            // ---- 7. 查单（data = {secret, widget, status}）----
            const qMatch = path.match(/^\/shared\/commodity\/query\/(.+)$/);
            if (qMatch) {
                const tradeNo = decodeURIComponent(qMatch[1]);
                const ref = await db.prepare('SELECT * FROM api_order_refs WHERE downstream_order_no=? AND credential_id=?').bind(tradeNo, aa.cred.id).first()
                    || await db.prepare('SELECT * FROM api_order_refs WHERE order_id=? AND credential_id=?').bind(tradeNo, aa.cred.id).first();
                if (!ref) { await logApiCall(db, aa, request, 200, 'acg_not_found'); return acgErr('订单不存在'); }
                const o = await db.prepare('SELECT * FROM orders WHERE id=?').bind(ref.order_id).first();
                if (!o) return acgErr('订单不存在');
                const cr = (await db.prepare('SELECT content FROM cards WHERE order_id=? ORDER BY id ASC').bind(ref.order_id).all()).results || [];
                await logApiCall(db, aa, request, 200);
                return acgOk({
                    secret: cr.map(c => stripCardNote(c.content)).join('\n'),
                    widget: null,
                    status: o.status === 1 ? 1 : (o.status === 0 ? 0 : 2)
                });
            }

            // ---- 8. 预选卡列表（{list:[{id,draft,draft_premium}], total}，3.1.2 形状）----
            if (path === '/shared/commodity/draftCard') {
                const p = await acgFindGoods(form.code || form.sharedCode);
                if (!p) return acgErr('商品不存在');
                const limit = Math.min(100, Math.max(1, parseInt(form.limit) || 10));
                const vars = await acgVarsOf(p);
                const v = acgRacePick(vars, acgRaceKeyMap(vars), form.race);
                const rows = (await db.prepare(`SELECT id, content FROM cards WHERE status=0 AND variant_id IN (SELECT id FROM variants WHERE product_id=?) ${v ? 'AND variant_id=?' : ''} ORDER BY id ASC LIMIT ?`)
                    .bind(...(v ? [p.id, v.id, limit] : [p.id, limit])).all()).results || [];
                await logApiCall(db, aa, request, 200);
                return acgOk({
                    total: rows.length,
                    list: rows.map(c => ({
                        id: c.id,
                        draft: (c.content.match(/#\[(.*?)\]/) || [, ''])[1],
                        draft_premium: 0
                    }))
                });
            }

            // ---- 9. 预选单卡详情（{draft_premium}）----
            if (path === '/shared/commodity/draft') {
                const p = await acgFindGoods(form.code || form.sharedCode);
                if (!p) return acgErr('商品不存在');
                const cardId = parseInt(form.card_id) || 0;
                const c = await db.prepare('SELECT id, content FROM cards WHERE id=? AND status=0 AND variant_id IN (SELECT id FROM variants WHERE product_id=?)')
                    .bind(cardId, p.id).first();
                if (!c) return acgErr('预选的宝贝不存在');
                await logApiCall(db, aa, request, 200);
                return acgOk({ id: c.id, draft: (c.content.match(/#\[(.*?)\]/) || [, ''])[1], draft_premium: 0 });
            }

            // ---- 10. 实时库存（{stock}）----
            if (path === '/shared/commodity/stock') {
                const p = await acgFindGoods(form.code || form.sharedCode);
                if (!p) { await logApiCall(db, aa, request, 200, 'acg_not_found'); return acgErr('商品不存在'); }
                const vars = await acgVarsOf(p);
                const v = acgRacePick(vars, acgRaceKeyMap(vars), form.race);
                let stock = 0;
                if (v) stock = await acgStockOf(v);
                else for (const x of vars) stock += await acgStockOf(x);
                await logApiCall(db, aa, request, 200);
                return acgOk({ stock });
            }

            // ---- 11. 定价（{price: 总价, currency_code}）----
            if (path === '/shared/commodity/valuation') {
                const p = await acgFindGoods(form.code || form.sharedCode);
                if (!p) return acgErr('商品不存在#0');
                const vars = await acgVarsOf(p);
                const v = acgRacePick(vars, acgRaceKeyMap(vars), form.race);
                if (!v) return acgErr('商品不存在#0');
                const num = Math.max(1, parseInt(form.num) || 1);
                const unit = await apiUnitPrice(db, aa, v, { member_price_enabled: p.member_price_enabled }, num, acgDiscount);
                await logApiCall(db, aa, request, 200);
                return acgOk({ price: (Math.round(unit * num * 100) / 100).toFixed(2), currency_code: 'CNY' });
            }

            await logApiCall(db, aa, request, 200, 'acg_no_route');
            return acgErr('接口不存在', 404);
        }

        // ===========================
                // --- 开放 API (Open) /api/open/v1/* ---
        // ===========================
        if (path.startsWith('/api/open/v1/')) {
            await ensureApiTables(db);
            const auth = await apiAuth(request, env, db, path);
            if (!auth.ok) {
                await logApiCall(db, null, request, auth.code, 'auth_failed');
                return openErr(auth.code, auth.msg, auth.retry_after ? { retry_after: auth.retry_after } : null);
            }
            // [v3+] scopes 权限校验
            if (!scopeAllows(auth.cred, method, path)) {
                await logApiCall(db, auth, request, 403, 'insufficient_scope');
                return openErr(403, 'api key 无权执行此操作（scopes 未授予）');
            }

            // 统计可用库存（自动发货 = 未售卡密数；手动发货 = variants.stock）
            const stockOf = async (variant) => {
                if (variant.auto_delivery === 1) {
                    const r = await db.prepare('SELECT COUNT(*) as c FROM cards WHERE variant_id=? AND status=0').bind(variant.id).first();
                    return r ? (r.c || 0) : 0;
                }
                return parseInt(variant.stock) || 0;
            };
            // 组装对外商品/规格结构
            const buildGoods = async (p, vars) => {
                const skus = [];
                for (const v of vars) {
                    let wc = null;
                    if (v.wholesale_config) {
                        try { wc = typeof v.wholesale_config === 'string' ? JSON.parse(v.wholesale_config) : v.wholesale_config; } catch(e) { wc = null; }
                    }
                    const stock = await stockOf(v);
                    skus.push({
                        id: v.id,
                        sku_code: 'v' + v.id,
                        name: v.name,
                        price_amount: (parseFloat(v.price) || 0).toFixed(2),
                        original_price: (parseFloat(v.price) || 0).toFixed(2),
                        wholesale_prices: Array.isArray(wc) ? wc.map(r => ({ qty: parseInt(r.qty) || 0, price: (parseFloat(r.price) || 0).toFixed(2) })) : [],
                        stock_quantity: v.auto_delivery === 1 ? stock : (parseInt(v.stock) || 0),
                        stock_status: stock > 0 ? 'in_stock' : 'out_of_stock',
                        is_active: v.active === 1,
                        auto_delivery: v.auto_delivery === 1 ? 1 : 0
                    });
                }
                return {
                    id: p.id,
                    category_id: p.category_id,
                    name: p.name,
                    description: (p.description || '').replace(/<[^>]+>/g, '').substring(0, 500),
                    image_url: p.image_url || '',
                    tags: p.tags || '',
                    price_amount: skus.length ? skus.map(s => parseFloat(s.price_amount)).sort((a, b) => a - b)[0].toFixed(2) : '0.00',
                    currency: 'CNY',
                    fulfillment_type: (vars[0] && vars[0].auto_delivery === 1) ? 'auto' : 'manual',
                    is_active: p.active === 1,
                    skus
                };
            };

            // ---- 1. 余额 ----
            if (path === '/api/open/v1/balance' && method === 'GET') {
                await logApiCall(db, auth, request, 200);
                return openOk({
                    user_id: auth.user.id,
                    username: auth.user.username || auth.user.email || '',
                    balance: parseFloat(auth.user.balance || 0).toFixed(2),
                    currency: 'CNY',
                    member_level: auth.user.member_level || 0,
                    price_mode: auth.cred.price_mode || 'member',
                    api_key: auth.cred.api_key
                });
            }

            // ---- 2. 商品列表 ----
            if (path === '/api/open/v1/goods/list' && method === 'GET') {
                // [v3+] 60s 边缘缓存命中直接返回，不查 D1
                const _ck2 = edgeCacheReq(url, auth.cred.api_key);
                const _hit2 = await edgeCacheMatch(_ck2);
                if (_hit2) { await logApiCall(db, auth, request, 200, 'cache_hit'); return _hit2; }
                const page = Math.max(1, parseInt(url.searchParams.get('page')) || 1);
                const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get('page_size')) || 20));
                const catId = url.searchParams.get('category_id');
                let where = 'WHERE p.active=1 AND p.api_enabled=1';
                const binds = [];
                if (catId) { where += ' AND p.category_id=?'; binds.push(catId); }
                const total = (await db.prepare(`SELECT COUNT(*) as c FROM products p ${where}`).bind(...binds).first() || {}).c || 0;
                const rows = (await db.prepare(`SELECT p.* FROM products p ${where} ORDER BY p.sort DESC, p.id ASC LIMIT ? OFFSET ?`)
                    .bind(...binds, pageSize, (page - 1) * pageSize).all()).results || [];
                const items = [];
                if (rows.length) {
                    const ids = rows.map(p => p.id);
                    const ph = ids.map(() => '?').join(',');
                    const allVars = (await db.prepare(`SELECT * FROM variants WHERE product_id IN (${ph}) AND active=1 ORDER BY sort DESC, id ASC`).bind(...ids).all()).results || [];
                    for (const p of rows) {
                        items.push(await buildGoods(p, allVars.filter(v => v.product_id === p.id)));
                    }
                }
                await logApiCall(db, auth, request, 200);
                const _resp2 = openOk({ total, page, page_size: pageSize, items });
                try { ctx.waitUntil(edgeCachePut(_ck2, _resp2, EDGE_CACHE_TTL_LIST)); } catch (e) {}
                return _resp2;
            }

            // ---- 3. 商品详情 ----
            if (path === '/api/open/v1/goods/detail' && method === 'GET') {
                const id = parseInt(url.searchParams.get('id'));
                if (!id) { await logApiCall(db, auth, request, 400, 'bad_request'); return openErr(400, '缺少商品 id'); }
                const p = await db.prepare('SELECT * FROM products WHERE id=? AND api_enabled=1').bind(id).first();
                if (!p) { await logApiCall(db, auth, request, 404, 'goods_not_found'); return openErr(404, '商品不存在或未开放 API 销售'); }
                const vars = (await db.prepare('SELECT * FROM variants WHERE product_id=? AND active=1 ORDER BY sort DESC, id ASC').bind(id).all()).results || [];
                await logApiCall(db, auth, request, 200);
                return openOk(await buildGoods(p, vars));
            }

            // ---- 4. 实时库存 ----
            if (path === '/api/open/v1/goods/stock' && method === 'GET') {
                const id = parseInt(url.searchParams.get('id'));
                const variantId = url.searchParams.get('variant_id');
                if (!id) { await logApiCall(db, auth, request, 400, 'bad_request'); return openErr(400, '缺少商品 id'); }
                const p = await db.prepare('SELECT id, api_enabled, active FROM products WHERE id=? AND api_enabled=1').bind(id).first();
                if (!p) { await logApiCall(db, auth, request, 404, 'goods_not_found'); return openErr(404, '商品不存在或未开放 API 销售'); }
                const vars = (await db.prepare(`SELECT * FROM variants WHERE product_id=? AND active=1 ${variantId ? 'AND id=?' : ''} ORDER BY sort DESC, id ASC`)
                    .bind(...(variantId ? [id, variantId] : [id])).all()).results || [];
                const out = [];
                for (const v of vars) {
                    const stock = await stockOf(v);
                    out.push({ variant_id: v.id, sku_code: 'v' + v.id, name: v.name, stock_quantity: stock, stock_status: stock > 0 ? 'in_stock' : 'out_of_stock' });
                }
                await logApiCall(db, auth, request, 200);
                return openOk({ goods_id: id, skus: out });
            }

            // ---- 5. 创建采购单 ----
            if (path === '/api/open/v1/order/create' && method === 'POST') {
                // [v3] 递归深度守卫：A→B→A→B 无限循环保护
                if (chainDepth(request) >= CHAIN_DEPTH_LIMIT) {
                    await logApiCall(db, auth, request, 400, 'chain_depth_exceeded');
                    return openErr(400, '链路过深，检测到可能的循环调用');
                }
                let body = {};
                try { body = await request.json(); } catch(e) { await logApiCall(db, auth, request, 400, 'bad_request'); return openErr(400, '请求体必须是 JSON'); }
                const goodsId = parseInt(body.goods_id);
                const variantId = parseInt(body.variant_id);
                const num = parseInt(body.num) || 0;
                const outTradeNo = (body.out_trade_no || '').toString().trim().substring(0, 64);
                const notifyUrl = (body.notify_url || '').toString().trim().substring(0, 500);
                if (!goodsId || !variantId) { await logApiCall(db, auth, request, 400, 'bad_request'); return openErr(400, 'goods_id 与 variant_id 必填'); }
                if (num < 1 || num > 200) { await logApiCall(db, auth, request, 400, 'bad_request'); return openErr(400, 'num 必须是 1-200 的整数'); }

                // 幂等：同一 credential 的相同 out_trade_no 直接返回已有订单
                if (outTradeNo) {
                    const ref = await db.prepare('SELECT order_id FROM api_order_refs WHERE credential_id=? AND downstream_order_no=?').bind(auth.cred.id, outTradeNo).first();
                    if (ref) {
                        const old = await db.prepare('SELECT * FROM orders WHERE id=?').bind(ref.order_id).first();
                        if (old) {
                            await logApiCall(db, auth, request, 200, 'idempotent_hit');
                            return openOk({ order_id: old.id, order_no: old.id, out_trade_no: outTradeNo, status: old.status === 1 ? 'delivered' : (old.status === 0 ? 'pending' : 'canceled'), amount: parseFloat(old.total_amount || 0).toFixed(2), currency: 'CNY', idempotent: true });
                        }
                    }
                }

                const p = await db.prepare('SELECT * FROM products WHERE id=? AND api_enabled=1 AND active=1').bind(goodsId).first();
                if (!p) { await logApiCall(db, auth, request, 404, 'goods_not_found'); return openErr(404, '商品不存在、已下架或未开放 API 销售'); }
                const v = await db.prepare('SELECT * FROM variants WHERE id=? AND product_id=? AND active=1').bind(variantId, goodsId).first();
                if (!v) { await logApiCall(db, auth, request, 404, 'sku_not_found'); return openErr(404, '规格不存在或已停售'); }

                // 库存预检
                const stock = await stockOf(v);
                if (stock < num) { await logApiCall(db, auth, request, 409, 'insufficient_stock'); return openErr(409, '库存不足，当前可用 ' + stock); }

                // 计价
                const unit = await apiUnitPrice(db, auth, v, p, num);
                const total = Math.round(unit * num * 100) / 100;
                if (!(total > 0)) { await logApiCall(db, auth, request, 400, 'bad_price'); return openErr(400, '计价结果非法，请联系管理员'); }

                // 余额不足（返回 200 + code，与 dujiao-next 协议同精神：调用方按业务码判断）
                if ((parseFloat(auth.user.balance) || 0) < total) {
                    await logApiCall(db, auth, request, 200, 'payment_failed');
                    return openErr(402, '余额不足，当前余额 ' + (parseFloat(auth.user.balance) || 0).toFixed(2) + '，需 ' + total.toFixed(2));
                }

                const orderId = uuid();
                const now = time();

                // 1) 抢占卡密（仅自动发货）
                let cards = [];
                if (v.auto_delivery === 1) {
                    const cands = (await db.prepare('SELECT id FROM cards WHERE variant_id=? AND status=0 ORDER BY id ASC LIMIT ?').bind(variantId, num).all()).results || [];
                    if (cands.length < num) { await logApiCall(db, auth, request, 409, 'insufficient_stock'); return openErr(409, '库存不足'); }
                    const ids = cands.map(c => c.id);
                    const ph = ids.map(() => '?').join(',');
                    await db.prepare(`UPDATE cards SET status=1, order_id=?, api_ref_id=? WHERE id IN (${ph}) AND status=0`)
                        .bind(orderId, auth.cred.id, ...ids).run();
                    cards = (await db.prepare('SELECT id, content FROM cards WHERE order_id=? AND variant_id=? ORDER BY id ASC').bind(orderId, variantId).all()).results || [];
                    if (cards.length < num) {
                        // 并发抢占失败：全部释放，避免半单
                        await db.prepare('UPDATE cards SET status=0, order_id=NULL, api_ref_id=NULL WHERE order_id=? AND variant_id=?').bind(orderId, variantId).run();
                        await logApiCall(db, auth, request, 409, 'stock_race');
                        return openErr(409, '库存竞争失败，请重试');
                    }
                }

                // 2) 扣余额（原子：条件 UPDATE + changes 判定）
                const dec = await db.prepare('UPDATE users SET balance = balance - ?, updated_at=? WHERE id=? AND balance >= ?')
                    .bind(total, now, auth.user.id, total).run();
                if (!dec.success || dec.meta.changes !== 1) {
                    if (cards.length) await db.prepare('UPDATE cards SET status=0, order_id=NULL, api_ref_id=NULL WHERE order_id=? AND variant_id=?').bind(orderId, variantId).run();
                    await logApiCall(db, auth, request, 200, 'payment_failed');
                    return openErr(402, '余额不足，扣款失败');
                }

                // 3) 落订单 + 流水 + 幂等引用
                await db.prepare('INSERT INTO orders (id, trade_no, variant_id, product_name, variant_name, price, quantity, total_amount, contact, query_password, payment_method, created_at, status, cards_sent, user_id, order_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
                    .bind(orderId, outTradeNo || null, variantId, p.name, v.name, unit, num, total.toFixed(2),
                        auth.user.email || auth.user.username || ('api_' + auth.cred.id), 'api_' + auth.cred.id,
                        'balance', now, 1, cards.length ? JSON.stringify(cards.map(c => ({ id: c.id, content: c.content }))) : null,
                        auth.user.id, 'api').run();
                await db.prepare('INSERT INTO balance_transactions (user_id, amount, type, description, order_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
                    .bind(auth.user.id, -total, 'api_purchase', 'API 采购 ' + p.name + ' x' + num, orderId, now).run();
                const refIns2 = await db.prepare('INSERT INTO api_order_refs (credential_id, order_id, downstream_order_no, trace_id, callback_url, callback_status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
                    .bind(auth.cred.id, orderId, outTradeNo || null, (body.trace_id || '').toString().substring(0, 64) || null,
                        notifyUrl || null, notifyUrl ? 'pending' : 'none', now).run();
                if (notifyUrl && auth.cred.allow_callback !== 0) {
                    const cbPayload2 = buildApiCallbackPayload('order.delivered', {
                        refId: refIns2.meta.last_row_id, orderNo: orderId,
                        downstreamOrderNo: outTradeNo || null, traceId: (body.trace_id || '').toString().substring(0, 64) || null,
                        status: 'delivered', amount: total.toFixed(2),
                        cards: v.auto_delivery === 1 ? cards.map(c => stripCardNote(c.content)) : [], deliveredAt: now
                    });
                    try { ctx.waitUntil(deliverApiCallback(db, auth.cred, refIns2.meta.last_row_id, notifyUrl, cbPayload2)); } catch (e) {}
                }

                await logApiCall(db, auth, request, 200);
                return openOk({
                    order_id: orderId,
                    order_no: orderId,
                    out_trade_no: outTradeNo || null,
                    status: 'delivered',
                    amount: total.toFixed(2),
                    unit_price: unit.toFixed(2),
                    quantity: num,
                    currency: 'CNY',
                    fulfillment_type: v.auto_delivery === 1 ? 'auto' : 'manual',
                    cards: v.auto_delivery === 1 ? cards.map(c => c.content) : []
                });
            }

            // ---- 6. 查单 ----
            if (path === '/api/open/v1/order/query' && method === 'GET') {
                const orderId = url.searchParams.get('order_id');
                const outTradeNo = url.searchParams.get('out_trade_no');
                if (!orderId && !outTradeNo) { await logApiCall(db, auth, request, 400, 'bad_request'); return openErr(400, 'order_id 与 out_trade_no 至少填一个'); }
                const ref = orderId
                    ? await db.prepare('SELECT * FROM api_order_refs WHERE order_id=? AND credential_id=?').bind(orderId, auth.cred.id).first()
                    : await db.prepare('SELECT * FROM api_order_refs WHERE downstream_order_no=? AND credential_id=?').bind(outTradeNo, auth.cred.id).first();
                if (!ref) { await logApiCall(db, auth, request, 404, 'order_not_found'); return openErr(404, '订单不存在'); }
                const o = await db.prepare('SELECT * FROM orders WHERE id=?').bind(ref.order_id).first();
                if (!o) { await logApiCall(db, auth, request, 404, 'order_not_found'); return openErr(404, '订单不存在'); }
                let cards = [];
                try {
                    const raw = await db.prepare('SELECT content FROM cards WHERE order_id=?').bind(ref.order_id).all();
                    cards = (raw.results || []).map(r => r.content);
                } catch(e) {}
                await logApiCall(db, auth, request, 200);
                return openOk({
                    order_id: o.id, order_no: o.id, out_trade_no: ref.downstream_order_no || null,
                    status: o.status === 1 ? 'delivered' : (o.status === 0 ? 'pending' : 'canceled'),
                    amount: parseFloat(o.total_amount || 0).toFixed(2), currency: 'CNY',
                    quantity: o.quantity, cards,
                    created_at: o.created_at, paid_at: o.paid_at || null
                });
            }

            // ---- 7. 取消订单（仅未发货的可取消，退余额 + 释放卡密）----
            if (path === '/api/open/v1/order/cancel' && method === 'POST') {
                let body = {};
                try { body = await request.json(); } catch(e) { await logApiCall(db, auth, request, 400, 'bad_request'); return openErr(400, '请求体必须是 JSON'); }
                const orderId = (body.order_id || '').toString();
                const ref = await db.prepare('SELECT * FROM api_order_refs WHERE order_id=? AND credential_id=?').bind(orderId, auth.cred.id).first();
                if (!ref) { await logApiCall(db, auth, request, 404, 'order_not_found'); return openErr(404, '订单不存在'); }
                const o = await db.prepare('SELECT * FROM orders WHERE id=?').bind(orderId).first();
                if (!o) { await logApiCall(db, auth, request, 404, 'order_not_found'); return openErr(404, '订单不存在'); }
                if (o.status !== 0) { await logApiCall(db, auth, request, 409, 'already_paid'); return openErr(409, '订单已支付/已发货，无法取消'); }
                const now = time();
                await db.prepare('UPDATE cards SET status=0, order_id=NULL, api_ref_id=NULL WHERE order_id=?').bind(orderId).run();
                await touchProductsByOrder(db, orderId);
                await db.prepare('UPDATE users SET balance = balance + ?, updated_at=? WHERE id=?').bind(o.total_amount, now, auth.user.id).run();
                await db.prepare('INSERT INTO balance_transactions (user_id, amount, type, description, order_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
                    .bind(auth.user.id, parseFloat(o.total_amount), 'api_refund', 'API 取消订单退回余额', orderId, now).run();
                await db.prepare('UPDATE orders SET status=2 WHERE id=?').bind(orderId).run();
                await logApiCall(db, auth, request, 200);
                return openOk({ order_id: orderId, status: 'canceled', refunded: parseFloat(o.total_amount).toFixed(2) });
            }

            await logApiCall(db, auth, request, 404, 'not_found');
            return openErr(404, '接口不存在');
        }

        // ===========================
        // --- 管理员 API (Admin) ---
        // ===========================
        if (path.startsWith('/api/admin/')) {
            
            /// --- 图形验证码生成接口（服务端存储答案，一次性令牌校验） ---
            if (path === '/api/admin/captcha') {
                return jsonRes(await createCaptcha(db));
            }

            // 登录接口豁免 (加入双重安全校验)
            // [安全加固] 登录接口 — 增加 IP 频率限制（5分钟内最多5次失败）
            if (path === '/api/admin/login') {
                if (method === 'POST') {
                    const clientIP = getClientIP(request);
                    const { user, pass, turnstileToken, captchaText, captchaHash, captchaExpire } = await request.json();             
                    const confRes = await db.prepare("SELECT key, value FROM site_config WHERE key IN ('admin_turnstile_active', 'turnstile_secret_key', 'admin_captcha_active')").all();
                    const conf = {}; confRes.results?.forEach(r => conf[r.key] = r.value);
                    // 默认开启图形验证码（数据库未设置时视为开启）
                    if (conf.admin_captcha_active === undefined) conf.admin_captcha_active = '1';

                    // [安全加固] 先检查频率限制（在所有验证之前，防止绕过验证码）
                    try { await db.prepare('CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, count INTEGER DEFAULT 1, first_attempt INTEGER NOT NULL)').run(); } catch(e) {}
                    const rateLimitKey = `login_fail_${clientIP}`;
                    let rateInfo = null;
                    try {
                        const row = await db.prepare("SELECT count, first_attempt FROM rate_limits WHERE key = ?").bind(rateLimitKey).first();
                        if (row) rateInfo = row;
                    } catch(e) {}
                    
                    const now = Math.floor(Date.now() / 1000);
                    const windowSeconds = 300; // 5分钟窗口
                    const maxAttempts = 5;
                    
                    if (rateInfo && (now - rateInfo.first_attempt) < windowSeconds && rateInfo.count >= maxAttempts) {
                        const remainSeconds = windowSeconds - (now - rateInfo.first_attempt);
                        return errRes(`登录失败次数过多，请 ${remainSeconds} 秒后重试`, 429);
                    }

                    // 1. 校验 Turnstile 人机验证
                    if (conf.admin_turnstile_active === '1' && conf.turnstile_secret_key) {
                        if (!turnstileToken) return errRes('请完成人机验证', 400);
                        const verifyRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                            body: `secret=${conf.turnstile_secret_key}&response=${turnstileToken}`
                        });
                        const verifyData = await verifyRes.json();
                        if (!verifyData.success) return errRes('人机验证未通过，请刷新重试', 400);
                    }

                    // 2. 校验数字+字母图形验证码（服务端一次性令牌）
                    if (conf.admin_captcha_active === '1') {
                        if (!(await verifyCaptcha(db, captchaText, captchaHash, captchaExpire))) {
                            return errRes('图形验证码错误或已过期，请刷新重试', 400);
                        }
                    }

                    // 3. 验证用户名密码
                    if (user === env.ADMIN_USER && pass === env.ADMIN_PASS) {
                        // 登录成功：清除失败记录
                        try {
                            await db.prepare("DELETE FROM rate_limits WHERE key = ?").bind(rateLimitKey).run();
                        } catch(e) {}
                        return jsonRes({ token: env.ADMIN_TOKEN });
                    }

                    // 登录失败：记录失败次数
                    try {
                        if (!rateInfo || (now - rateInfo.first_attempt) >= windowSeconds) {
                            await db.prepare("INSERT INTO rate_limits (key, count, first_attempt) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count=1, first_attempt=excluded.first_attempt")
                                .bind(rateLimitKey, now).run();
                        } else {
                            await db.prepare("UPDATE rate_limits SET count=count+1 WHERE key=?").bind(rateLimitKey).run();
                        }
                    } catch(e) {
                        console.error('Rate limit write error:', e);
                    }

                    return errRes('用户名或密码错误', 401);
                }
                return errRes('Method Not Allowed', 405);
            }

            // 非登录接口的鉴权
            const authHeader = request.headers.get('Authorization');
            if (!authHeader || authHeader !== `Bearer ${env.ADMIN_TOKEN}`) {
                return errRes('Unauthorized', 401);
            }
            
            // --- 仪表盘 (升级版：支持多时间维度) ---
            if (path === '/api/admin/dashboard') {
                // [修复] 新库首次进后台时 api_call_logs 可能尚未建表，
                //        直接查会让整个 dashboard 500。先幂等补齐。
                await ensureApiTables(db);
                const now = Math.floor(Date.now() / 1000);
                const today = new Date().setHours(0,0,0,0) / 1000;
                const week = now - 7 * 86400;   // 最近7天
                const month = now - 30 * 86400; // 最近30天
                const year = now - 365 * 86400; // 最近一年

                // 使用 Promise.all 并发查询，提高速度
                const [
                    r_o_today, r_o_week, r_o_month,
                    r_i_today, r_i_week, r_i_month, r_i_year,
                    r_cards, r_pending,
                    // [修复] API 额度告警（阶段5）：把 api_call_logs 聚合成可告警的指标
                    r_api_today, r_api_today_fail, r_api_week, r_api_week_fail,
                    r_api_errs, r_api_top, r_api_last
                ] = await Promise.all([
                    // 订单数统计
                    db.prepare("SELECT COUNT(*) as c FROM orders WHERE created_at >= ?").bind(today).first(),
                    db.prepare("SELECT COUNT(*) as c FROM orders WHERE created_at >= ?").bind(week).first(),
                    db.prepare("SELECT COUNT(*) as c FROM orders WHERE created_at >= ?").bind(month).first(),
                    
                    // 收入统计
                    db.prepare("SELECT SUM(total_amount) as s FROM orders WHERE status >= 1 AND paid_at >= ?").bind(today).first(),
                    db.prepare("SELECT SUM(total_amount) as s FROM orders WHERE status >= 1 AND paid_at >= ?").bind(week).first(),
                    db.prepare("SELECT SUM(total_amount) as s FROM orders WHERE status >= 1 AND paid_at >= ?").bind(month).first(),
                    db.prepare("SELECT SUM(total_amount) as s FROM orders WHERE status >= 1 AND paid_at >= ?").bind(year).first(),
                    
                    // 其他
                    db.prepare("SELECT COUNT(*) as c FROM cards WHERE status = 0").first(),
                    db.prepare("SELECT COUNT(*) as c FROM orders WHERE status = 0").first(),

                    // API 调用量 / 失败数
                    db.prepare("SELECT COUNT(*) as c FROM api_call_logs WHERE created_at >= ?").bind(today).first(),
                    db.prepare("SELECT COUNT(*) as c FROM api_call_logs WHERE created_at >= ? AND status_code >= 400").bind(today).first(),
                    db.prepare("SELECT COUNT(*) as c FROM api_call_logs WHERE created_at >= ?").bind(week).first(),
                    db.prepare("SELECT COUNT(*) as c FROM api_call_logs WHERE created_at >= ? AND status_code >= 400").bind(week).first(),
                    // 失败原因 Top（定位时钟漂移/签名错/余额不足等）
                    db.prepare("SELECT COALESCE(error_code,'(无)') as code, COUNT(*) as c FROM api_call_logs WHERE created_at >= ? AND status_code >= 400 GROUP BY error_code ORDER BY c DESC LIMIT 8").bind(today).all(),
                    // 调用方 Top（发现被盗用的 key）
                    db.prepare("SELECT l.credential_id as cred_id, u.username, u.email, COUNT(*) as c FROM api_call_logs l LEFT JOIN users u ON u.id = l.user_id WHERE l.created_at >= ? AND l.credential_id IS NOT NULL GROUP BY l.credential_id ORDER BY c DESC LIMIT 8").bind(today).all(),
                    db.prepare("SELECT MAX(created_at) as t FROM api_call_logs").first()
                ]);

                const apiToday = r_api_today.c || 0;
                const apiTodayFail = r_api_today_fail.c || 0;
                const apiWeek = r_api_week.c || 0;
                const apiWeekFail = r_api_week_fail.c || 0;
                const failRate = apiToday > 0 ? Math.round(apiTodayFail / apiToday * 1000) / 10 : 0;

                const stats = {
                    orders: {
                        today: r_o_today.c,
                        week: r_o_week.c,
                        month: r_o_month.c
                    },
                    income: {
                        today: r_i_today.s || 0,
                        week: r_i_week.s || 0,
                        month: r_i_month.s || 0,
                        year: r_i_year.s || 0
                    },
                    cards_unsold: r_cards.c,
                    orders_pending: r_pending.c,
                    // [修复] API 额度告警：前端据此标红
                    api: {
                        today: apiToday,
                        today_fail: apiTodayFail,
                        fail_rate: failRate,          // 百分比，1 位小数
                        week: apiWeek,
                        week_fail: apiWeekFail,
                        week_fail_rate: apiWeek > 0 ? Math.round(apiWeekFail / apiWeek * 1000) / 10 : 0,
                        top_errors: (r_api_errs.results || []).map(r => ({ code: r.code, count: r.c })),
                        top_callers: (r_api_top.results || []).map(r => ({
                            cred_id: r.cred_id,
                            name: r.username || r.email || ('key_' + r.cred_id),
                            count: r.c
                        })),
                        last_call_at: r_api_last.t || 0,
                        // 告警阈值（前端只负责标红，阈值判定在服务端，口径统一）
                        alert_fail_rate: failRate >= 10,
                        alert_volume: apiToday >= 5000
                    }
                };
                
                return jsonRes(stats);
            }
            // --- 商品分类 API ---
            if (path === '/api/admin/categories/list') {
                const { results } = await db.prepare("SELECT * FROM categories ORDER BY sort DESC, id DESC").all();
                return jsonRes(results);
            }
            // [修改] 保存分类 (增加 image_url)
            if (path === '/api/admin/category/save' && method === 'POST') {
                const { id, name, sort, image_url } = await request.json();
                if (id) {
                    await db.prepare("UPDATE categories SET name=?, sort=?, image_url=?, updated_at=? WHERE id=?").bind(name, sort, image_url, time(), id).run();
                } else {
                    await db.prepare("INSERT INTO categories (name, sort, image_url, updated_at) VALUES (?, ?, ?, ?)").bind(name, sort, image_url, time()).run();
                }
                return jsonRes({ success: true });
            }
            if (path === '/api/admin/category/delete' && method === 'POST') {
                const { id } = await request.json();
                if (id === 1) return errRes('默认分类不能删除');
                await db.prepare("UPDATE products SET category_id = 1, updated_at = ? WHERE category_id = ?").bind(time(), id).run();
                await db.prepare("DELETE FROM categories WHERE id = ?").bind(id).run();
                return jsonRes({ success: true });
            }

            // --- 商品管理 API ---
            if (path === '/api/admin/products/list') {
                const products = (await db.prepare("SELECT * FROM products ORDER BY sort DESC, id DESC").all()).results;
                for (let p of products) {
                    p.variants = (await db.prepare("SELECT * FROM variants WHERE product_id = ?").bind(p.id).all()).results;
                    p.variants.forEach(v => {
                        if (v.wholesale_config) {
                             try { v.wholesale_config = JSON.parse(v.wholesale_config); } catch(e) { v.wholesale_config = null; }
                        }
                    });
                }
                return jsonRes(products);
            }
            
            // [新增] 商品级“会员价”开关（列表内快捷切换，默认开启；关闭后本商品不参与会员折扣）
            if (path === '/api/admin/product/member_price' && method === 'POST') {
                const { id, enabled } = await request.json();
                if (!id) return errRes('缺少商品ID');
                // 归一化 enabled（防止字符串 "0"/"false" 被真值判断误当作开启）
                const memberPriceVal = (enabled === true || enabled === 1 || enabled === '1') ? 1 : 0;
                const upd = await db.prepare("UPDATE products SET member_price_enabled=? WHERE id=?").bind(memberPriceVal, id).run();
                if (!upd.meta || !upd.meta.changes) return errRes('商品不存在');
                return jsonRes({ success: true, member_price_enabled: memberPriceVal });
            }

            // [v2] 商品级 API 开放开关（白名单制，默认关闭）
            if (path === '/api/admin/product/api_enabled' && method === 'POST') {
                await ensureProductColumns(db);
                const { id, enabled } = await request.json();
                if (!id) return errRes('缺少商品ID');
                const apiVal = (enabled === true || enabled === 1 || enabled === '1') ? 1 : 0;
                const upd2 = await db.prepare("UPDATE products SET api_enabled=? WHERE id=?").bind(apiVal, id).run();
                if (!upd2.meta || !upd2.meta.changes) return errRes('商品不存在');
                return jsonRes({ success: true, api_enabled: apiVal });
            }

            // 商品保存逻辑 (含 tags 支持)
            if (path === '/api/admin/product/save' && method === 'POST') {
                const data = await request.json();
                let productId = data.id;
                const now = time();

                // 1. 保存主商品 (增加 tags / seo_description / member_price_enabled 字段)
                const memberPriceEnabled = data.member_price_enabled === 0 ? 0 : 1; // 默认开启会员价
                // [v2] 是否允许被 API 调用购买（白名单制，默认关闭）
                const apiEnabled = data.api_enabled ? 1 : 0;
                if (productId) {
                    await db.prepare("UPDATE products SET name=?, description=?, category_id=?, sort=?, active=?, image_url=?, tags=?, seo_description=?, member_price_enabled=?, api_enabled=?, updated_at=? WHERE id=?")
                        .bind(data.name, data.description, data.category_id, data.sort, data.active, data.image_url, data.tags, data.seo_description, memberPriceEnabled, apiEnabled, now, productId).run();
                } else {
                    const res = await db.prepare("INSERT INTO products (category_id, sort, active, created_at, updated_at, name, description, image_url, tags, seo_description, member_price_enabled, api_enabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
                        .bind(data.category_id, data.sort, data.active, now, now, data.name, data.description, data.image_url, data.tags, data.seo_description, memberPriceEnabled, apiEnabled).run();
                    productId = res.meta.last_row_id;
                }

                // 2. 处理规格
                const existingVariants = (await db.prepare("SELECT id FROM variants WHERE product_id=?").bind(productId).all()).results;
                const newVariantIds = [];
                const updateStmts = [];
                
                // 增加 selection_label 和 random_mode_text 字段
                const insertStmt = db.prepare(`
                    INSERT INTO variants (product_id, name, price, stock, color, image_url, wholesale_config, custom_markup, auto_delivery, sales_count, created_at, random_mode_text, selection_label, sort, active, updated_at) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `);
                const updateStmt = db.prepare(`
                    UPDATE variants SET name=?, price=?, stock=?, color=?, image_url=?, wholesale_config=?, custom_markup=?, auto_delivery=?, sales_count=?, random_mode_text=?, selection_label=?, sort=?, active=?, updated_at=?
                    WHERE id=? AND product_id=?
                `);

                for (const v of data.variants) {
                    const wholesale_config_json = v.wholesale_config ? JSON.stringify(v.wholesale_config) : null;
                    const auto_delivery = v.auto_delivery !== undefined ? Number(v.auto_delivery) : 1;
                    const stock = v.stock !== undefined ? v.stock : 0;
                    const variantId = v.id ? parseInt(v.id) : null;

                    if (variantId) { // 更新
                        newVariantIds.push(variantId);
                        updateStmts.push(
                            updateStmt.bind(
                                v.name, v.price, stock, v.color, v.image_url, wholesale_config_json, 
                                v.custom_markup || 0, auto_delivery, v.sales_count || 0,
                                v.random_mode_text || null, v.selection_label || null,
                                v.sort || 0, v.active, now,
                                variantId, productId
                            )
                        );
                    } else { // 插入
                        updateStmts.push(
                            insertStmt.bind(
                                productId, v.name, v.price, stock, v.color, v.image_url, wholesale_config_json,
                                v.custom_markup || 0, auto_delivery, v.sales_count || 0, now,
                                v.random_mode_text || null, v.selection_label || null,
                                v.sort || 0, v.active, now
                            )
                        );
                    }
                }
                
                // 3. 删除旧规格 ([安全加固] 使用参数化查询替代字符串拼接)
                const deleteIds = existingVariants.filter(v => !newVariantIds.includes(v.id)).map(v => v.id);
                if (deleteIds.length > 0) {
                    const placeholders = deleteIds.map(() => '?').join(',');
                    updateStmts.push(db.prepare(`DELETE FROM variants WHERE id IN (${placeholders})`).bind(...deleteIds));
                }

                if (updateStmts.length > 0) {
                    await db.batch(updateStmts);
                }
                await db.prepare(`
                UPDATE variants 
                SET stock = (SELECT COUNT(*) FROM cards WHERE variant_id = variants.id AND status = 0) 
                WHERE product_id = ? AND (auto_delivery = 1 OR (SELECT COUNT(*) FROM cards WHERE variant_id = variants.id AND status = 0) > 0)
                `).bind(productId).run();
                
                return jsonRes({ success: true, productId: productId });
            }

            // [新增] 导出商品 (JSON 文件下载) —— 只导出：商品分类 / 商品 / 规格，**不含卡密**
            // 卡密请在【卡密管理】中单独导出与导入；本文件可直接在新部署的本系统【商品管理 → 导入商品】中导入。
            if (path === '/api/admin/products/export' && method === 'POST') {
                // 1. 商品分类
                const { results: catRows } = await db.prepare("SELECT * FROM categories ORDER BY sort DESC, id ASC").all();
                const catMap = {};
                for (const c of catRows) catMap[c.id] = c;

                // 2. 商品 + 规格 (绝不查询 cards 表)：一次性取出全部规格再按商品分组，避免逐商品查询
                const { results: prodRows } = await db.prepare("SELECT * FROM products ORDER BY category_id ASC, sort DESC, id ASC").all();
                const { results: allVariants } = await db.prepare("SELECT * FROM variants ORDER BY sort DESC, id ASC").all();
                const variantsByProduct = {};
                for (const v of allVariants) {
                    if (!variantsByProduct[v.product_id]) variantsByProduct[v.product_id] = [];
                    variantsByProduct[v.product_id].push(v);
                }
                const products = [];
                for (const p of prodRows) {
                    const variants = variantsByProduct[p.id] || [];
                    const cat = catMap[p.category_id] || null;
                    products.push({
                        id: p.id,
                        category_id: p.category_id,
                        category_name: cat ? cat.name : '',
                        name: p.name,
                        description: p.description || '',
                        sort: p.sort || 0,
                        active: p.active,
                        created_at: p.created_at || null,
                        image_url: p.image_url || '',
                        tags: p.tags || '',
                        seo_description: p.seo_description || '',
                        member_price_enabled: p.member_price_enabled === 0 ? 0 : 1,
                        variants: variants.map(v => {
                            // 批发配置在库中是 JSON 字符串，导出时还原成数组便于阅读，导入时会自动序列化回去
                            let wholesale = null;
                            if (v.wholesale_config) {
                                try { wholesale = typeof v.wholesale_config === 'string' ? JSON.parse(v.wholesale_config) : v.wholesale_config; }
                                catch (e) { wholesale = v.wholesale_config; }
                            }
                            return {
                                id: v.id,
                                name: v.name,
                                price: v.price,
                                stock: v.stock || 0,
                                color: v.color || null,
                                image_url: v.image_url || null,
                                wholesale_config: wholesale,
                                custom_markup: v.custom_markup || 0,
                                sales_count: v.sales_count || 0,
                                auto_delivery: v.auto_delivery,
                                created_at: v.created_at || null,
                                selection_label: v.selection_label || null,
                                sort: v.sort || 0,
                                active: v.active,
                                random_mode_text: v.random_mode_text || null
                            };
                        })
                    });
                }

                // 3. 生成导出文件
                const exportData = {
                    format: 'xyfk2-products',
                    version: 1,
                    exported_at: time(),
                    includes_cards: false,
                    note: '商品数据导出文件（含：商品分类 / 商品 / 规格；不含卡密）。卡密请在【卡密管理】中单独导出与导入。可直接在新部署的本系统【商品管理 → 导入商品】中导入，缺失的商品分类会自动创建并关联到对应商品。',
                    categories: catRows.map(c => ({ id: c.id, name: c.name, sort: c.sort || 0, image_url: c.image_url || '' })),
                    products: products
                };

                return new Response(JSON.stringify(exportData, null, 2), {
                    headers: {
                        'Content-Type': 'application/json; charset=utf-8',
                        'Content-Disposition': `attachment; filename="products_export_${time()}.json"`
                    }
                });
            }

            // [新增] 导入商品 —— 兼容【导出商品】生成的 JSON 文件
            // 1) 商品分类不存在时自动创建，并自动把商品关联到对应分类
            // 2) 不导入卡密（卡密请在【卡密管理】中导入）
            if (path === '/api/admin/products/import' && method === 'POST') {
                const body = await request.json();
                const data = body && body.data ? body.data : body;
                const mode = (body && body.mode === 'insert') ? 'insert' : 'skip'; // skip=跳过同名商品 insert=仍然新建

                if (data && data.format && data.format !== 'xyfk2-products') {
                    return errRes('文件格式不正确：请使用本系统【导出商品】生成的 JSON 文件');
                }
                if (data && data.includes_cards) {
                    return errRes('该文件包含卡密数据，卡密请在【卡密管理】中导入');
                }
                if (!data || typeof data !== 'object' || !Array.isArray(data.products)) {
                    return errRes('文件格式不正确：缺少商品数据 (products)，请使用本系统【导出商品】生成的 JSON 文件');
                }
                const fileList = data.products;
                if (fileList.length === 0) return errRes('文件中没有可导入的商品');

                // 1. 读取文件内的分类信息 (id -> { name, sort, image_url })
                const fileCats = {};
                if (Array.isArray(data.categories)) {
                    for (const c of data.categories) {
                        if (c && c.id !== undefined && c.name) {
                            fileCats[c.id] = { name: String(c.name).trim(), sort: Number(c.sort) || 0, image_url: c.image_url || '' };
                        }
                    }
                }
                // 商品所属分类名：优先商品上的 category_name，其次按 category_id 查文件分类表
                const catNameOf = (p) => {
                    if (p.category_name && String(p.category_name).trim()) return String(p.category_name).trim();
                    const fc = fileCats[p.category_id];
                    return fc ? fc.name : '';
                };

                // 2. 对照现有分类，找出缺失的分类并自动创建
                const existCats = (await db.prepare("SELECT id, name FROM categories").all()).results;
                const catMap = {}; // 分类名 -> 分类 id
                for (const c of existCats) {
                    const n = String(c.name).trim();
                    if (n && catMap[n] === undefined) catMap[n] = c.id;
                }
                const needCats = [];
                const needCatNames = new Set();
                for (const p of fileList) {
                    if (!p) continue;
                    const n = catNameOf(p);
                    if (!n || catMap[n] !== undefined || needCatNames.has(n)) continue;
                    needCatNames.add(n);
                    const fc = fileCats[p.category_id];
                    needCats.push({ name: n, sort: fc ? fc.sort : 0, image_url: fc ? fc.image_url : '' });
                }
                const createdCategories = [];
                if (needCats.length > 0) {
                    const catStmts = needCats.map(c => db.prepare("INSERT INTO categories (name, sort, image_url, updated_at) VALUES (?, ?, ?, ?)").bind(c.name, c.sort, c.image_url, time()));
                    for (let i = 0; i < catStmts.length; i += 50) {
                        const batchRes = await db.batch(catStmts.slice(i, i + 50));
                        batchRes.forEach((r, idx) => {
                            const c = needCats[i + idx];
                            catMap[c.name] = r.meta.last_row_id;
                            createdCategories.push(c.name);
                        });
                    }
                }

                // 3. 同名商品去重 (仅 skip 模式生效)
                const existNames = new Set((await db.prepare("SELECT name FROM products").all()).results.map(r => r.name));

                // 4. 批量导入商品与规格（分批写入，避免商品多时撑爆 Workers 子请求上限）
                const now = time();
                let importedProducts = 0;
                let importedVariants = 0;
                const skipped = [];
                const newProductIds = [];

                const pending = [];
                for (const p of fileList) {
                    if (!p || !p.name) continue;
                    const name = String(p.name).trim();
                    if (!name) continue;
                    if (mode === 'skip' && existNames.has(name)) { skipped.push(name); continue; }

                    const catName = catNameOf(p);
                    const categoryId = (catName && catMap[catName] !== undefined) ? catMap[catName] : 1;
                    pending.push({
                        name: name,
                        categoryId: categoryId,
                        sort: Number(p.sort) || 0,
                        active: p.active === undefined ? 1 : (Number(p.active) ? 1 : 0),
                        created_at: Number(p.created_at) || now,
                        description: p.description || '',
                        image_url: p.image_url || '',
                        tags: p.tags || '',
                        seo_description: p.seo_description || '',
                        member_price_enabled: p.member_price_enabled === 0 ? 0 : 1,
                        variants: Array.isArray(p.variants) ? p.variants : []
                    });
                }

                // 4.1 批量插入商品
                for (let i = 0; i < pending.length; i += 50) {
                    const chunk = pending.slice(i, i + 50);
                    const stmts = chunk.map(x => db.prepare("INSERT INTO products (category_id, sort, active, created_at, name, description, image_url, tags, seo_description, member_price_enabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
                        .bind(x.categoryId, x.sort, x.active, x.created_at, x.name, x.description, x.image_url, x.tags, x.seo_description, x.member_price_enabled));
                    const batchRes = await db.batch(stmts);
                    batchRes.forEach((r, idx) => {
                        const newId = r.meta.last_row_id;
                        chunk[idx].newId = newId;
                        newProductIds.push(newId);
                        importedProducts++;
                    });
                }

                // 4.2 批量插入规格
                const vStmts = [];
                for (const x of pending) {
                    for (const v of x.variants) {
                        if (!v || !v.name) continue;
                        let wholesaleJson = null;
                        if (v.wholesale_config !== null && v.wholesale_config !== undefined && v.wholesale_config !== '') {
                            wholesaleJson = (typeof v.wholesale_config === 'string') ? v.wholesale_config : JSON.stringify(v.wholesale_config);
                        }
                        vStmts.push(db.prepare("INSERT INTO variants (product_id, name, price, stock, color, image_url, wholesale_config, custom_markup, sales_count, auto_delivery, created_at, selection_label, sort, active, random_mode_text, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
                            .bind(
                                x.newId,
                                String(v.name).trim(),
                                Number(v.price) || 0,
                                parseInt(v.stock) || 0,
                                v.color || null,
                                v.image_url || null,
                                wholesaleJson,
                                Number(v.custom_markup) || 0,
                                parseInt(v.sales_count) || 0,
                                v.auto_delivery === undefined ? 1 : (Number(v.auto_delivery) ? 1 : 0),
                                Number(v.created_at) || now,
                                v.selection_label || null,
                                Number(v.sort) || 0,
                                v.active === undefined ? 1 : (Number(v.active) ? 1 : 0),
                                v.random_mode_text || null,
                                now
                            ));
                        importedVariants++;
                    }
                }
                for (let i = 0; i < vStmts.length; i += 100) {
                    await db.batch(vStmts.slice(i, i + 100));
                }

                // 5. 库存同步 (与保存商品时同一套逻辑)：
                //    自动发货 / 已有卡密的规格，库存以卡密数量为准；导入不含卡密，故此类规格库存先归 0，
                //    之后在【卡密管理】导入卡密时会自动回填库存。手动发货且无卡密的规格保留导出的库存值。
                if (newProductIds.length > 0) {
                    for (let i = 0; i < newProductIds.length; i += 50) {
                        const ids = newProductIds.slice(i, i + 50);
                        const placeholders = ids.map(() => '?').join(',');
                        await db.prepare(`
                            UPDATE variants
                            SET stock = (SELECT COUNT(*) FROM cards WHERE variant_id = variants.id AND status = 0), updated_at = ${now}
                            WHERE product_id IN (${placeholders}) AND (auto_delivery = 1 OR (SELECT COUNT(*) FROM cards WHERE variant_id = variants.id AND status = 0) > 0)
                        `).bind(...ids).run();
                    }
                }

                return jsonRes({
                    success: true,
                    imported: importedProducts,
                    variants: importedVariants,
                    created_categories: createdCategories,
                    skipped: skipped
                });
            }
            
            // [修复] 删除商品 —— 原先后端缺少该接口，导致后台“删除/批量删除”按钮报 “API Not Found”
            // 级联删除：商品 -> 规格 -> 卡密；历史订单保留快照字段，不受影响
            if (path === '/api/admin/product/delete' && method === 'POST') {
                const body = await request.json();
                // 兼容单个 id 与批量 ids 两种入参
                let ids = [];
                if (Array.isArray(body.ids)) ids = body.ids;
                else if (body.id !== undefined && body.id !== null) ids = [body.id];
                ids = ids.map(x => Number(x)).filter(x => Number.isInteger(x) && x > 0);
                if (ids.length === 0) return errRes('参数不完整：缺少商品 id');

                const placeholders = ids.map(() => '?').join(',');
                const exist = (await db.prepare(`SELECT id FROM products WHERE id IN (${placeholders})`).bind(...ids).all()).results;
                if (exist.length === 0) return errRes('商品不存在');
                const existIds = exist.map(r => r.id);
                const ph2 = existIds.map(() => '?').join(',');

                // 显式逐层删除（不依赖 SQLite 外键级联是否开启）：卡密 -> 规格 -> 商品
                await db.batch([
                    db.prepare(`DELETE FROM cards WHERE variant_id IN (SELECT id FROM variants WHERE product_id IN (${ph2}))`).bind(...existIds),
                    db.prepare(`DELETE FROM variants WHERE product_id IN (${ph2})`).bind(...existIds),
                    db.prepare(`DELETE FROM products WHERE id IN (${ph2})`).bind(...existIds)
                ]);
                return jsonRes({ success: true, deleted: existIds.length });
            }

            // --- 订单管理 API ---
            if (path === '/api/admin/orders/list') {
                const search = url.searchParams.get('search');
                const status = url.searchParams.get('status');
                let whereClauses = ["1=1"];
                let params = [];
                
                if (search) {
                    whereClauses.push("(contact LIKE ? OR id LIKE ?)");
                    params.push(`%${search}%`, `%${search}%`);
                }
                if (status !== null && status !== '') {
                    whereClauses.push("status = ?");
                    params.push(parseInt(status));
                }
                const query = `SELECT * FROM orders WHERE ${whereClauses.join(' AND ')} ORDER BY created_at DESC LIMIT 100`;
                
                const { results } = await db.prepare(query).bind(...params).all();
                return jsonRes(results);
            }

            // *** 新增: 删除单个订单 ***
            if (path === '/api/admin/order/delete' && method === 'POST') {
                const { id } = await request.json();
                if (!id) return errRes('未提供订单ID');
                await db.prepare("DELETE FROM orders WHERE id = ?").bind(id).run();
                await db.prepare("DELETE FROM site_config WHERE key=?").bind('qr_' + id).run();
                return jsonRes({ success: true });
            }

            // *** 新增: 批量删除订单 ***
            if (path === '/api/admin/orders/batch_delete' && method === 'POST') {
                const { ids } = await request.json();
                if (!Array.isArray(ids) || ids.length === 0) {
                    return errRes('未提供订单ID列表');
                }
                
                // 构建 IN 查询
                const placeholders = ids.map(() => '?').join(',');
                await db.prepare(`DELETE FROM orders WHERE id IN (${placeholders})`).bind(...ids).run();
                const qrKeys = ids.map(id => 'qr_' + id);
                await db.prepare(`DELETE FROM site_config WHERE key IN (${placeholders})`).bind(...qrKeys).run();
                return jsonRes({ success: true, deletedCount: ids.length });
            }
            // *** 新增/修改: 保存订单 (包含编辑卡密发货) ***
            if (path === '/api/admin/order/save' && method === 'POST') {
                const { id, status, contact, cards_sent } = await request.json();
                if (!id) return errRes('未提供订单ID');
                
                let cardsJson = null;
                if (cards_sent) {
                    // 按行分割并转为 JSON 数组，过滤空行
                    cardsJson = JSON.stringify(cards_sent.split('\n').filter(s => s.trim() !== ''));
                } else {
                    cardsJson = '[]';
                }

                await db.prepare("UPDATE orders SET status=?, contact=?, cards_sent=? WHERE id=?")
                    .bind(status, contact, cardsJson, id).run();
                return jsonRes({ success: true });
            }


            // --- 卡密管理 API (升级版: 支持分页、多字段搜索、关联查询) ---
            if (path === '/api/admin/cards/list') {
                const product_id = url.searchParams.get('product_id'); 
                const variant_id = url.searchParams.get('variant_id');
                const status = url.searchParams.get('status');
                const kw = url.searchParams.get('kw'); // 搜索关键字
                const page = parseInt(url.searchParams.get('page') || 1); // 当前页码
                const limit = parseInt(url.searchParams.get('limit') || 10); // 每页条数
                const offset = (page - 1) * limit;
                let whereClauses = ["1=1"];
                let params = [];

                if (product_id) {
                    whereClauses.push("p.id = ?");
                    params.push(product_id);
                }

                if (variant_id) {
                    whereClauses.push("c.variant_id = ?");
                    params.push(variant_id);
                }
                if (status !== null && status !== '') {
                    whereClauses.push("c.status = ?");
                    params.push(parseInt(status));
                }
                // [修改] 关键字同时搜索：卡密内容 OR 商品名称 OR 规格名称
                if (kw) {
                    whereClauses.push("(c.content LIKE ? OR p.name LIKE ? OR v.name LIKE ?)");
                    params.push(`%${kw}%`, `%${kw}%`, `%${kw}%`);
                }

                const whereSql = whereClauses.join(" AND ");
                
                // 定义 JOIN 子句 (统计和查询都需要用到)
                const joinSql = `
                    LEFT JOIN variants v ON c.variant_id = v.id
                    LEFT JOIN products p ON v.product_id = p.id
                `;

                // 1. 查询总数 ([注意] 必须包含 JOIN，否则无法根据商品名筛选)
                const countSql = `SELECT COUNT(*) as total FROM cards c ${joinSql} WHERE ${whereSql}`;
                const total = (await db.prepare(countSql).bind(...params).first()).total;

                // 2. 查询数据
                const dataSql = `
                    SELECT c.*, v.name as variant_name, p.name as product_name 
                    FROM cards c
                    ${joinSql}
                    WHERE ${whereSql} 
                    ORDER BY c.id DESC 
                    LIMIT ? OFFSET ?
                `;
                
                // 追加分页参数
                params.push(limit, offset);
                
                const { results } = await db.prepare(dataSql).bind(...params).all();

                return jsonRes({
                    data: results,
                    total: total,
                    page: page,
                    limit: limit
                });
            }

            if (path === '/api/admin/cards/import' && method === 'POST') {
                const { variant_id, content } = await request.json();
                const cards = content.split('\n').filter(c => c.trim()).map(c => c.trim());
                if (cards.length > 0) {
                    const stmt = db.prepare("INSERT INTO cards (variant_id, content, status, created_at) VALUES (?, ?, 0, ?)");
                    const stmts = cards.map(c => stmt.bind(variant_id, c, time()));
                    for (let i = 0; i < stmts.length; i += 100) {
                        await db.batch(stmts.slice(i, i + 100));
                    }
                    // 更新库存
                    await db.prepare("UPDATE variants SET stock = (SELECT COUNT(*) FROM cards WHERE variant_id=? AND status=0) WHERE id = ?")
                        .bind(variant_id, variant_id).run();
                    await touchProductsByVariant(db, variant_id);
                }
                return jsonRes({ imported: cards.length });
            }

            // [新增] 导出卡密接口
            if (path === '/api/admin/cards/export' && method === 'POST') {
                const { product_id, variant_id, export_unsold, export_sold } = await request.json();

                // 1. 构建查询条件
                let whereClauses = [];
                let params = [];

                if (product_id) {
                    whereClauses.push("p.id = ?");
                    params.push(product_id);
                }
                if (variant_id) {
                    whereClauses.push("v.id = ?");
                    params.push(variant_id);
                }

                // 状态筛选
                if (export_unsold && !export_sold) {
                    whereClauses.push("c.status = 0");
                } else if (!export_unsold && export_sold) {
                    whereClauses.push("c.status = 1");
                } else if (!export_unsold && !export_sold) {
                    return errRes('请至少选择一种导出状态（已售或未售）');
                }
                // 如果都选，则不加 status 限制

                const whereSql = whereClauses.length > 0 ? "WHERE " + whereClauses.join(" AND ") : "";

                // 2. 联表查询：卡密 -> 规格 -> 商品
                const sql = `
                    SELECT c.content, c.status, p.name as p_name, v.name as v_name 
                    FROM cards c 
                    JOIN variants v ON c.variant_id = v.id 
                    JOIN products p ON v.product_id = p.id 
                    ${whereSql}
                    ORDER BY p.id ASC, v.id ASC, c.id ASC
                `;

                const { results } = await db.prepare(sql).bind(...params).all();

                if (!results || results.length === 0) {
                    return errRes('没有找到符合条件的卡密');
                }

                // 3. 数据分组处理 (按 商品-规格 分类)
                const groups = {};
                for (const row of results) {
                    const key = `【商品：${row.p_name}】 - 【规格：${row.v_name}】`;
                    if (!groups[key]) groups[key] = [];
                    groups[key].push(row.content);
                }

                // 4. 生成文本内容
                let fileContent = "";
                for (const [groupName, cards] of Object.entries(groups)) {
                    fileContent += `${groupName}\n`;
                    fileContent += `--------------------------------------------------\n`;
                    fileContent += cards.join('\n');
                    fileContent += `\n\n==================================================\n\n`;
                }

                // 5. 返回文件下载响应
                return new Response(fileContent, {
                    headers: {
                        'Content-Type': 'text/plain; charset=utf-8',
                        'Content-Disposition': `attachment; filename="cards_export_${time()}.txt"`
                    }
                });
            }

             if (path === '/api/admin/card/delete' && method === 'POST') {
                const { id } = await request.json();
                const card = await db.prepare("SELECT variant_id, status FROM cards WHERE id=?").bind(id).first();
                if (!card) return errRes('卡密不存在');
                
                await db.prepare("DELETE FROM cards WHERE id=?").bind(id).run();
                // 更新库存
                await db.prepare("UPDATE variants SET stock = (SELECT COUNT(*) FROM cards WHERE variant_id=? AND status=0) WHERE id = ?")
                        .bind(card.variant_id, card.variant_id).run();
                await touchProductsByVariant(db, card.variant_id);
                return jsonRes({ success: true });
            }

            // --- 支付网关 API ---
            if (path === '/api/admin/gateways/list') {
                 await ensurePayGatewayColumns(db);
                 let { results } = await db.prepare("SELECT * FROM pay_gateways ORDER BY sort DESC, id ASC").all();
                 if (results.length === 0) {
                     const emptyConfig = { app_id: "", private_key: "", alipay_public_key: "" };
                     await db.prepare("INSERT INTO pay_gateways (name, type, config, active) VALUES (?, ?, ?, ?)")
                         .bind('支付宝当面付', 'alipay_f2f', JSON.stringify(emptyConfig), 0).run();
                     results = (await db.prepare("SELECT * FROM pay_gateways").all()).results;
                 }
                 results.forEach(g => g.config = JSON.parse(g.config));
                 return jsonRes(results);
            }
            if (path === '/api/admin/gateway/save' && method === 'POST') {
                await ensurePayGatewayColumns(db);
                const { id, name, type, config, active, remark, sort, member_recharge } = await request.json();
                const safeRemark = remark || null; // 防止 remark 为 undefined 导致数据库崩溃
                const safeSort = (sort !== undefined && sort !== null && sort !== '') ? parseInt(sort) : 0;
                const safeMemberRecharge = member_recharge ? 1 : 0; // 会员充值开关
                
                if (id) {
                    // 如果存在 ID，则更新旧数据
                    await db.prepare("UPDATE pay_gateways SET name=?, type=?, config=?, active=?, remark=?, sort=?, member_recharge=? WHERE id=?")
                       .bind(name, type, JSON.stringify(config), active, safeRemark, safeSort, safeMemberRecharge, id).run();
                } else {
                    // 如果没有 ID，则插入新数据 (前端自动初始化 4 个 U 网络时会走到这里)
                    await db.prepare("INSERT INTO pay_gateways (name, type, config, active, remark, sort, member_recharge) VALUES (?, ?, ?, ?, ?, ?, ?)")
                       .bind(name, type, JSON.stringify(config), active, safeRemark, safeSort, safeMemberRecharge).run();
                }
                return jsonRes({success: true});
            }
            if (path === '/api/admin/gateway/delete' && method === 'POST') {
                const { id } = await request.json();
                if (!id) return errRes('ID不能为空');
                await db.prepare("DELETE FROM pay_gateways WHERE id=?").bind(id).run();
                return jsonRes({ success: true });
            }

            // --- 文章分类 API ---
            if (path === '/api/admin/article_categories/list') {
                const { results } = await db.prepare("SELECT * FROM article_categories ORDER BY sort DESC, id DESC").all();
                return jsonRes(results);
            }
            if (path === '/api/admin/article_category/save' && method === 'POST') {
                const { id, name, sort } = await request.json();
                if (id) {
                    await db.prepare("UPDATE article_categories SET name=?, sort=? WHERE id=?").bind(name, sort, id).run();
                } else {
                    await db.prepare("INSERT INTO article_categories (name, sort) VALUES (?, ?)").bind(name, sort).run();
                }
                return jsonRes({ success: true });
            }
            if (path === '/api/admin/article_category/delete' && method === 'POST') {
                const { id } = await request.json();
                if (id === 1) return errRes('默认分类不能删除');
                await db.prepare("UPDATE articles SET category_id = 1 WHERE category_id = ?").bind(id).run();
                await db.prepare("DELETE FROM article_categories WHERE id = ?").bind(id).run();
                return jsonRes({ success: true });
            }

            // --- 文章管理 API ---
            if (path === '/api/admin/articles/list') {
                const { results } = await db.prepare(`
                    SELECT a.*, ac.name as category_name 
                    FROM articles a 
                    LEFT JOIN article_categories ac ON a.category_id = ac.id
                    ORDER BY a.created_at DESC
                `).all();
                return jsonRes(results);
            }
            // [修复] 文章保存逻辑：增加了 cover_image, active, view_count 字段
            if (path === '/api/admin/article/save' && method === 'POST') {
                const { id, title, content, is_notice, category_id, cover_image, active, view_count, seo_description } = await request.json();
                const now = time();
                if (id) {
                    await db.prepare("UPDATE articles SET title=?, content=?, is_notice=?, category_id=?, updated_at=?, cover_image=?, active=?, view_count=?, seo_description=? WHERE id=?")
                        .bind(title, content, is_notice, category_id, now, cover_image, active, view_count, seo_description, id).run();
                } else {
                    await db.prepare("INSERT INTO articles (title, content, is_notice, category_id, created_at, updated_at, cover_image, active, view_count, seo_description) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
                        .bind(title, content, is_notice, category_id, now, now, cover_image, active, view_count, seo_description).run();
                }
                return jsonRes({ success: true });
            }
            if (path === '/api/admin/article/delete' && method === 'POST') {
                const { id } = await request.json();
                await db.prepare("DELETE FROM articles WHERE id=?").bind(id).run();
                return jsonRes({ success: true });
            }
            
            // --- 页面管理 API (新增) ---
            if (path === '/api/admin/pages/list') {
                const { results } = await db.prepare("SELECT id, title, alias, created_at, updated_at FROM pages ORDER BY created_at DESC").all();
                return jsonRes(results);
            }
            if (path === '/api/admin/page/save' && method === 'POST') {
                const { id, title, alias, content, seo_description } = await request.json();
                const now = time();
                if (id) {
                    await db.prepare("UPDATE pages SET title=?, alias=?, content=?, seo_description=?, updated_at=? WHERE id=?").bind(title, alias, content, seo_description, now, id).run();
                } else {
                    await db.prepare("INSERT INTO pages (title, alias, content, seo_description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").bind(title, alias, content, seo_description, now, now).run();
                }
                return jsonRes({ success: true });
            }
            if (path === '/api/admin/page/delete' && method === 'POST') {
                const { id } = await request.json();
                await db.prepare("DELETE FROM pages WHERE id=?").bind(id).run();
                return jsonRes({ success: true });
            }

            // ===========================
            // --- 图片管理 API (新增) ---
            // ===========================
            
            // 1. 获取图片分类
            if (path === '/api/admin/image/categories') {
                const { results } = await db.prepare("SELECT * FROM image_categories ORDER BY sort DESC, id ASC").all();
                return jsonRes(results);
            }
            // 2. 保存分类
            if (path === '/api/admin/image/category/save' && method === 'POST') {
                const { id, name, sort } = await request.json();
                if (id) {
                    await db.prepare("UPDATE image_categories SET name=?, sort=? WHERE id=?").bind(name, sort, id).run();
                } else {
                    await db.prepare("INSERT INTO image_categories (name, sort) VALUES (?, ?)").bind(name, sort).run();
                }
                return jsonRes({ success: true });
            }
            // 3. 删除分类
            if (path === '/api/admin/image/category/delete' && method === 'POST') {
                const { id } = await request.json();
                if (id == 1) return errRes('默认分类无法删除');
                // 将该分类下的图片移到默认分类
                await db.prepare("UPDATE images SET category_id = 1 WHERE category_id = ?").bind(id).run();
                await db.prepare("DELETE FROM image_categories WHERE id = ?").bind(id).run();
                return jsonRes({ success: true });
            }

            // 4. 图片列表
            if (path === '/api/admin/images/list') {
                const category_id = url.searchParams.get('category_id');
                const page = parseInt(url.searchParams.get('page') || 1);
                const limit = 20; // 每页20张
                const offset = (page - 1) * limit;

                let where = "1=1";
                let params = [];
                if (category_id && category_id !== 'all') {
                    where += " AND category_id = ?";
                    params.push(category_id);
                }

                const total = (await db.prepare(`SELECT COUNT(*) as c FROM images WHERE ${where}`).bind(...params).first()).c;
                const { results } = await db.prepare(`SELECT * FROM images WHERE ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).bind(...params, limit, offset).all();

                return jsonRes({ data: results, total, page, limit });
            }

            // 5. 保存图片 (支持批量添加：urls 用换行分隔)
            if (path === '/api/admin/image/save' && method === 'POST') {
                const { urls, category_id } = await request.json();
                if (!urls) return errRes('链接不能为空');
                
                const urlList = urls.split('\n').map(u => u.trim()).filter(u => u);
                const now = Math.floor(Date.now() / 1000);
                
                // 批量插入
                const stmt = db.prepare("INSERT INTO images (category_id, url, name, created_at) VALUES (?, ?, ?, ?)");
                const batch = urlList.map(u => {
                    // 尝试从URL提取文件名作为名称
                    let name = u.substring(u.lastIndexOf('/') + 1);
                    if(name.length > 50) name = name.substring(0, 50);
                    return stmt.bind(category_id || 1, u, name, now);
                });
                
                if (batch.length > 0) await db.batch(batch);
                return jsonRes({ success: true, count: batch.length });
            }

            // 6. 批量删除图片 (支持同时删除 R2 存储源文件)
            if (path === '/api/admin/image/delete' && method === 'POST') {
                const { ids, deleteStorage } = await request.json();
                if (!ids || ids.length === 0) return errRes('未选择图片');
                
                // 如果勾选了同时删除存储源文件，先查询并删除 R2 中的文件
                if (deleteStorage) {
                    const ph = ids.map(() => '?').join(',');
                    const imgs = (await db.prepare(`SELECT url FROM images WHERE id IN (${ph})`).bind(...ids).all()).results;
                    
                    // 删除 R2 文件
                    if (env.r2) {
                        const r2Keys = imgs
                            .map(i => i.url)
                            .filter(u => u && u.startsWith('/r2_image/'))
                            .map(u => u.replace('/r2_image/', ''));
                        for (const key of r2Keys) {
                            try { await env.r2.delete(key); } catch(e) { console.error('R2 delete error:', key, e); }
                        }
                    }
                }
                
                const placeholders = ids.map(() => '?').join(',');
                await db.prepare(`DELETE FROM images WHERE id IN (${placeholders})`).bind(...ids).run();
                return jsonRes({ success: true });
            }

            // 7. 修改图片信息（移动分类/重命名）
            if (path === '/api/admin/image/update' && method === 'POST') {
                const { id, name, category_id } = await request.json();
                await db.prepare("UPDATE images SET name=?, category_id=? WHERE id=?").bind(name, category_id, id).run();
                return jsonRes({ success: true });
            }

            // 8. [核心功能] 扫描全站图片并入库 (升级版：URL唯一 & 标题自动合并)
            if (path === '/api/admin/images/scan' && method === 'POST') {
                const now = Math.floor(Date.now() / 1000);
                
                // 使用 Map<URL, Set<Name>> 结构
                // Key: 图片URL (唯一)
                // Value: Set 集合 (存放该图片对应的所有名称，Set会自动去重)
                const scanMap = new Map();

                const add = (url, name) => {
                    if (!url) return;
                    url = url.trim(); // 去除首尾空格
                    
                    if (!scanMap.has(url)) {
                        scanMap.set(url, new Set());
                    }
                    
                    if (name) {
                        // 简单清洗名称（去掉可能的HTML标签），并添加到集合中
                        const cleanName = name.replace(/<[^>]+>/g, '').trim();
                        if(cleanName) scanMap.get(url).add(cleanName);
                    }
                };

                // 1. 扫描商品主图
                const products = await db.prepare("SELECT image_url, name FROM products WHERE image_url IS NOT NULL AND image_url != ''").all();
                products.results.forEach(p => add(p.image_url, p.name));

                // 2. 扫描商品规格图
                const variants = await db.prepare("SELECT image_url, name FROM variants WHERE image_url IS NOT NULL AND image_url != ''").all();
                variants.results.forEach(v => add(v.image_url, v.name));

                // 3. 扫描文章封面
                const articles = await db.prepare("SELECT cover_image, title FROM articles WHERE cover_image IS NOT NULL AND cover_image != ''").all();
                articles.results.forEach(a => add(a.cover_image, a.title));
                
                // 4. 扫描系统配置 (Logo/Favicon等)
                const config = await db.prepare("SELECT key, value FROM site_config").all();
                config.results.forEach(c => {
                    const val = c.value || '';
                    // 只要是图片链接就加进去
                    if(val.match(/^https?:\/\/.+\.(jpg|png|jpeg|gif|webp|ico|svg)$/i)) {
                        add(val, c.key);
                    }
                });

            // 5. (优化版) 直接构建插入语句，利用 SQL 判断是否存在，无需将所有 URL 加载到内存
                // 使用 WHERE NOT EXISTS 避免重复，这是防止内存溢出的最佳方案
                const stmt = db.prepare(`
                    INSERT INTO images (category_id, url, name, created_at) 
                    SELECT 1, ?1, ?2, ?3 
                    WHERE NOT EXISTS (SELECT 1 FROM images WHERE url = ?1)
                `);
                
                const batch = [];

                // 6. 遍历 Map 生成批量执行队列
                for (const [url, nameSet] of scanMap) {
                    // 拼接标题
                    let joinedName = Array.from(nameSet).join('/');
                    
                    // 截取长度防止溢出
                    if (joinedName.length > 100) {
                        joinedName = joinedName.substring(0, 97) + '...';
                    }
                    if (!joinedName) joinedName = '未命名图片';
                    
                    // 直接加入队列，无需在 JS 层判断是否存在
                    batch.push(stmt.bind(url, joinedName, now));
                }
                for (let i = 0; i < batch.length; i += 100) {
                    await db.batch(batch.slice(i, i + 100));
                }
                return jsonRes({ success: true, count: batch.length });
            }

            // ====== [核心网关] 统一智能上传分发接口 ======
            if (path === '/api/admin/image/upload' && method === 'POST') {
                // 读取用户在后台设置的默认图床，如果没设置，默认走通用外部图床
                const provider = (await db.prepare("SELECT value FROM site_config WHERE key='default_upload_provider'").first())?.value || 'custom';
                // 进行无缝内部路由重定向 (直接递归调用原本写好的具体接口，性能损耗为 0)
                if (provider === 'r2') {
                    return handleApi(request, env, new URL('/api/admin/r2/upload', request.url), ctx);
                }
                else if (provider === 'custom') {
                    return handleApi(request, env, new URL('/api/admin/image/external_upload', request.url), ctx);
                }
                else if (provider === 'telegram') {
                    return handleApi(request, env, new URL('/api/admin/tg/upload', request.url), ctx);
                }
                return errRes('未知的图床提供商设置，请检查后台配置');
            }
            // ====== [新增] Telegram 图床接口 ======
            if (path === '/api/admin/tg/upload' && method === 'POST') {
                const conf = {};
                (await db.prepare("SELECT key, value FROM site_config WHERE key IN ('tg_upload_bot_token','tg_upload_chat_id')").all()).results.forEach(r => conf[r.key] = r.value);
                if (!conf.tg_upload_bot_token || !conf.tg_upload_chat_id) return errRes('请先在系统设置配置 Telegram 图床的 Token 和 Chat ID');
                const formData = await request.formData();
                const file = formData.get('file');
                if (!file) return errRes('未选择文件');
                const tgForm = new FormData();
                tgForm.append('chat_id', conf.tg_upload_chat_id);
                tgForm.append('document', file);
                const upRes = await fetch(`https://api.telegram.org/bot${conf.tg_upload_bot_token}/sendDocument`, { method: 'POST', body: tgForm });
                const upData = await upRes.json();
                if (!upData.ok) return errRes('TG上传失败: ' + (upData.description || '未知错误'));
                const resData = upData.result;
                const fileId = (resData.document && resData.document.file_id) || 
                               (resData.sticker && resData.sticker.file_id) || 
                               (resData.photo && resData.photo[resData.photo.length - 1].file_id);
                if (!fileId) return errRes('TG返回数据异常，无法获取 file_id');
                // 3. 获取文件路径 file_path
                const pathRes = await fetch(`https://api.telegram.org/bot${conf.tg_upload_bot_token}/getFile?file_id=${fileId}`);
                const pathData = await pathRes.json();
                if (!pathData.ok) return errRes('获取TG路径失败');
                const downloadUrl = `/tg_image/${pathData.result.file_path}`;
                try { await db.prepare("INSERT INTO images (category_id, url, name, created_at) VALUES (1, ?, ?, ?)").bind(downloadUrl, file.name, time()).run(); } catch(e){}
                return jsonRes({ location: downloadUrl });
            }
            // ====== [新增] 万能外部图床通用接口 ======
                if (path === '/api/admin/image/external_upload' && method === 'POST') {
                    const conf = {};
                    (await db.prepare("SELECT key, value FROM site_config WHERE key IN ('custom_api_url','custom_api_token','custom_api_field')").all()).results.forEach(r => conf[r.key] = r.value);
                    
                    if (!conf.custom_api_url) return errRes('未配置外部图床 API 地址');

                    // [安全加固] 校验图床 API 地址本身是否合法
                    if (!isSafeUrl(conf.custom_api_url)) {
                        return errRes('图床 API 地址格式不合法，必须是 http:// 或 https:// 开头');
                    }

                    const formData = await request.formData();
                    const file = formData.get('file');
                    if (!file) return errRes('未选择文件');
                    const headers = {};
                    if (conf.custom_api_token) {
                        headers['Authorization'] = `Bearer ${conf.custom_api_token}`;
                        headers['Token'] = conf.custom_api_token; 
                    }
                    const uploadForm = new FormData();
                    uploadForm.append('file', file);
                    uploadForm.append('title', file.name);
                    if (formData.has('thumbnail')) uploadForm.append('thumbnail', formData.get('thumbnail'));
                    if (formData.has('dim')) uploadForm.append('dim', formData.get('dim'));
                    try {
                        const upRes = await fetch(conf.custom_api_url, { method: 'POST', headers, body: uploadForm });
                        const upText = await upRes.text();
                        let downloadUrl = '';
                        
                        try {
                            const upJson = JSON.parse(upText);
                            if (conf.custom_api_field) {
                                let temp = upJson;
                                const keys = conf.custom_api_field.split('.');
                                for (const k of keys) { temp = temp[k]; if (temp === undefined) break; }
                                if (typeof temp === 'string') downloadUrl = temp;
                            }
                            
                            if (!downloadUrl) {
                                if (Array.isArray(upJson) && upJson[0]?.src) downloadUrl = upJson[0].src; 
                                else if (upJson.data?.links?.url) downloadUrl = upJson.data.links.url; 
                                else if (upJson.data?.url) downloadUrl = upJson.data.url; 
                                else if (upJson.url) downloadUrl = upJson.url; 
                                else if (upJson.src) downloadUrl = upJson.src; 
                            }

                            if (downloadUrl && !downloadUrl.startsWith('http') && !downloadUrl.startsWith('/')) {
                                downloadUrl = new URL(downloadUrl, conf.custom_api_url).href;
                            }
                        } catch(e) {
                            if (upText.startsWith('http')) downloadUrl = upText.trim();
                        }

                        if (!downloadUrl) return errRes('未找到图片链接，返回内容：' + upText.substring(0, 100));

                        // [安全加固] 校验返回的URL是否安全
                        if (!isValidImageUrl(downloadUrl)) {
                            return errRes('图床返回的URL格式不合法，疑似恶意链接，已拦截');
                        }

                        try { await db.prepare("INSERT INTO images (category_id, url, name, created_at) VALUES (1, ?, ?, ?)").bind(downloadUrl, file.name, time()).run(); } catch(e){}
                        
                        return jsonRes({ location: downloadUrl });
                    } catch(e) {
                        return errRes('外部API上传请求异常: ' + e.message);
                    }
                }

            // ====== [新增] Cloudflare R2 图床上传接口 ======
            if (path === '/api/admin/r2/upload' && method === 'POST') {
                if (!env.r2) return errRes('R2 bucket 未绑定，请在 Cloudflare Pages 设置 → Functions → R2 bucket bindings 中添加变量名 r2');
                const formData = await request.formData();
                const file = formData.get('file');
                if (!file) return errRes('未选择文件');
                
                // 生成唯一文件名：日期/UUID.ext
                const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
                const datePrefix = new Date().toISOString().slice(0, 10).replace(/-/g, '');
                const key = `images/${datePrefix}/${uuid()}.${ext}`;
                
                // 上传到 R2
                await env.r2.put(key, file.stream(), {
                    httpMetadata: { contentType: file.type || 'image/jpeg' }
                });
                
                // 构建访问 URL
                const r2Domain = (await db.prepare("SELECT value FROM site_config WHERE key='r2_public_domain'").first())?.value || '';
                let downloadUrl = '';
                if (r2Domain) {
                    downloadUrl = `https://${r2Domain.replace(/^https?:\/\//, '')}/${key}`;
                } else {
                    downloadUrl = `/r2_image/${key}`;
                }
                
                // 记录到 images 表
                try {
                    await db.prepare("INSERT INTO images (category_id, url, name, created_at) VALUES (1, ?, ?, ?)")
                        .bind(downloadUrl, file.name, time()).run();
                } catch(e) {}
                
                return jsonRes({ location: downloadUrl, key: key });
            }

            // ====== [新增] Cloudflare R2 批量删除接口 ======
            if (path === '/api/admin/r2/delete' && method === 'POST') {
                if (!env.r2) return errRes('R2 bucket 未绑定');
                const { keys } = await request.json();
                if (!keys || keys.length === 0) return errRes('未提供文件 key');
                let deleted = 0;
                for (const key of keys) {
                    try { await env.r2.delete(key); deleted++; } catch(e) { console.error('R2 delete error:', key, e); }
                }
                return jsonRes({ success: true, deleted });
            }
            // --- 系统设置 API (已修改: 支持 UPSERT) ---
            if (path === '/api/admin/settings/get') {
                const res = await db.prepare("SELECT * FROM site_config").all();
                const config = {}; res.results.forEach(r => config[r.key] = r.value);
                return jsonRes(config);
            }
            if (path === '/api/admin/settings/save' && method === 'POST') {
                const settings = await request.json();
                // 使用 UPSERT 语法：如果键不存在则插入，存在则更新
                const stmts = Object.keys(settings).map(key => 
                    db.prepare(`
                        INSERT INTO site_config (key, value) VALUES (?, ?) 
                        ON CONFLICT(key) DO UPDATE SET value = excluded.value
                    `).bind(key, settings[key])
                );
                await db.batch(stmts);
                return jsonRes({ success: true });
            }

            // --- Outlook 发信测试接口 (支持机密客户端和公共客户端) ---
            if (path === '/api/admin/outlook/test' && method === 'POST') {
                const { client_id, client_secret, refresh_token, to_email } = await request.json();
                if (!client_id || !refresh_token) return errRes('请填写 Client ID 和 Refresh Token');
                if (!to_email) return errRes('请填写测试收件邮箱');
                try {
                    const result = await testOutlookConnection(client_id, client_secret || '', refresh_token, to_email);
                    if (result.success) return jsonRes({ success: true, message: result.message });
                    return errRes(result.message);
                } catch (e) {
                    return errRes('测试失败: ' + e.message);
                }
            }

            // === 会员管理 API (Admin) ===
            // [新增] 添加会员（管理员手动创建）
            if (path === '/api/admin/member/add' && method === 'POST') {
                const { username, email, password, balance, member_level, recharge_limit_per_tx, recharge_limit_total } = await request.json();
                if (!email || !password) return errRes('邮箱和密码不能为空');
                // [安全加固] 邮箱白名单字符，与注册接口保持一致
                if (!/^[A-Za-z0-9._%+\-\u4e00-\u9fa5]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/.test(email)) return errRes('请输入有效的邮箱地址');
                if (password.length < 6) return errRes('密码不能少于6位');
                if (password.length > 64) return errRes('密码不能超过64位');
                const initialBalance = parseFloat(balance) || 0;
                if (initialBalance < 0) return errRes('初始余额不能为负数');
                const initialLevel = parseInt(member_level) || 0;
                if (initialLevel < 0) return errRes('等级不能为负数');
                // [v1] 等级必须已在会员等级体系中配置，否则会静默无折扣
                const lvlCheck = await validateMemberLevel(db, initialLevel);
                if (!lvlCheck.ok) return errRes(lvlCheck.error);
                // [v1] 自助充值限额：未传则继承站点默认值
                const limRow = await db.prepare("SELECT key, value FROM site_config WHERE key IN ('member_recharge_limit_per_tx_default','member_recharge_limit_total_default')").all();
                const limDef = {}; (limRow.results || []).forEach(r => limDef[r.key] = parseFloat(r.value) || 0);
                const limPerTx = (recharge_limit_per_tx !== undefined && recharge_limit_per_tx !== null && recharge_limit_per_tx !== '')
                    ? (parseFloat(recharge_limit_per_tx) || 0) : (limDef.member_recharge_limit_per_tx_default || 0);
                const limTotal = (recharge_limit_total !== undefined && recharge_limit_total !== null && recharge_limit_total !== '')
                    ? (parseFloat(recharge_limit_total) || 0) : (limDef.member_recharge_limit_total_default || 0);
                if (limPerTx < 0 || limTotal < 0) return errRes('充值限额不能为负数');
                // 列/索引兼容已由 ensureMemberTables 统一处理（每个实例仅一次），不再逐请求 ALTER
                const existing = await db.prepare('SELECT id FROM users WHERE email=?').bind(email).first();
                if (existing) return errRes('该邮箱已注册');
                // 用户名：未填写时自动生成序号（001, 002, 003...），与注册接口逻辑一致
                let finalUsername = (username || '').trim();
                if (!finalUsername) {
                    const maxRow = await db.prepare("SELECT username FROM users WHERE username GLOB '[0-9]*' ORDER BY CAST(username AS INTEGER) DESC LIMIT 1").first();
                    const nextNum = maxRow ? (parseInt(maxRow.username, 10) || 0) + 1 : 1;
                    finalUsername = String(nextNum).padStart(3, '0');
                }
                const dupName = await db.prepare('SELECT id FROM users WHERE username=?').bind(finalUsername).first();
                if (dupName) return errRes('用户名已存在');
                const passwordHash = await hashPassword(password, env);
                const passwordEncrypted = await encryptPassword(password, env);
                const now = time();
                const result = await db.prepare('INSERT INTO users (username, password_hash, password_encrypted, email, balance, frozen, member_level, auto_level, level_source, recharge_limit_per_tx, recharge_limit_total, total_recharge, total_incoming, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, 0, 0, ?, ?)').bind(finalUsername, passwordHash, passwordEncrypted, email, initialBalance, initialLevel, initialLevel, 'auto', limPerTx, limTotal, now, now).run();
                const userId = result.meta.last_row_id;
                // 初始余额记入流水，便于对账
                if (initialBalance > 0) {
                    await db.prepare('INSERT INTO balance_transactions (user_id, amount, type, description, created_at) VALUES (?, ?, ?, ?, ?)').bind(userId, initialBalance, 'admin_adjust', '管理员添加会员-初始余额', now).run();
                }
                return jsonRes({ success: true, user: { id: userId, username: finalUsername, email, balance: initialBalance, member_level: initialLevel } });
            }

            // 会员列表
            if (path === '/api/admin/members/list') {
                const search = url.searchParams.get('search') || '';
                // frozen/member_level/total_recharge 列已由 ensureMemberTables 统一兼容（每个实例仅一次），不再逐请求 ALTER
                let query = 'SELECT u.id, u.username, u.email, u.balance, u.frozen, u.member_level, u.auto_level, u.level_source, u.recharge_limit_per_tx, u.recharge_limit_total, u.total_recharge, u.total_incoming, u.created_at, u.updated_at, (SELECT COUNT(*) FROM orders WHERE user_id=u.id) as order_count FROM users u';
                let params = [];
                if (search) {
                    query += ' WHERE u.username LIKE ? OR u.email LIKE ?';
                    params = ['%' + search + '%', '%' + search + '%'];
                }
                query += ' ORDER BY u.created_at DESC LIMIT 200';
                try {
                    const members = params.length
                        ? await db.prepare(query).bind(...params).all()
                        : await db.prepare(query).all();
                    return jsonRes({ members: members.results || [] });
                } catch (e) {
                    // [新增] 把真实错误返回给后台，便于 F12 直接定位问题
                    console.error('members/list error:', e);
                    return errRes('会员列表查询失败: ' + (e.message || e), 500);
                }
            }

            // 会员详情 (含密码、冻结状态、交易记录和订单)
            if (path === '/api/admin/member/detail') {
                const id = url.searchParams.get('id');
                if (!id) return errRes('缺少会员ID');
                // 列兼容已由 ensureMemberTables 统一处理，不再逐请求 ALTER
                const user = await db.prepare('SELECT id, username, email, balance, frozen, member_level, auto_level, level_source, recharge_limit_per_tx, recharge_limit_total, total_recharge, total_incoming, password_encrypted, created_at, updated_at FROM users WHERE id=?').bind(id).first();
                if (!user) return errRes('会员不存在');
                user.password_plaintext = user.password_encrypted ? await decryptPassword(user.password_encrypted, env) : null;
                delete user.password_encrypted;
                const transactions = await db.prepare('SELECT * FROM balance_transactions WHERE user_id=? ORDER BY created_at DESC LIMIT 20').bind(id).all();
                const orders = await db.prepare('SELECT id, product_name, variant_name, total_amount, status, created_at FROM orders WHERE user_id=? ORDER BY created_at DESC LIMIT 20').bind(id).all();
                return jsonRes({ user, transactions: transactions.results || [], orders: orders.results || [] });
            }

            // 调整会员余额
            if (path === '/api/admin/member/balance_adjust' && method === 'POST') {
                const { user_id, adjust_type, amount, description } = await request.json();
                if (!user_id || !adjust_type || !amount) return errRes('参数不完整');
                if (!['add', 'subtract', 'set'].includes(adjust_type)) return errRes('调整类型无效');
                if (amount < 0) return errRes('金额不能为负数');
                const member = await db.prepare('SELECT id, balance FROM users WHERE id=?').bind(user_id).first();
                if (!member) return errRes('会员不存在');
                let newBalance;
                if (adjust_type === 'add') newBalance = member.balance + amount;
                else if (adjust_type === 'subtract') newBalance = member.balance - amount;
                else newBalance = amount; // set
                if (newBalance < 0) return errRes('调整后余额不能为负数');
                const now = time();
                await db.prepare('UPDATE users SET balance=?, updated_at=? WHERE id=?').bind(newBalance, now, user_id).run();
                // 记录流水
                const txAmount = adjust_type === 'subtract' ? -amount : (adjust_type === 'add' ? amount : amount - member.balance);
                await db.prepare('INSERT INTO balance_transactions (user_id, amount, type, description, created_at) VALUES (?, ?, ?, ?, ?)').bind(user_id, txAmount, 'admin_adjust', description || '管理员手动调整', now).run();
                // [v1] 手动「加余额」计入累计入金（口径：自助充值 + 手动加余额都算入金，用于自动升级判定）。
                //      subtract / set 不计入：扣余额不是出金；set 无法推断入金金额。
                if (adjust_type === 'add') {
                    await db.prepare('UPDATE users SET total_incoming = total_incoming + ? WHERE id=?').bind(amount, user_id).run();
                    await applyAutoUpgrade(db, user_id);
                }
                return jsonRes({ success: true, new_balance: newBalance });
            }

            // 删除会员
            if (path === '/api/admin/member/delete' && method === 'POST') {
                const { user_id } = await request.json();
                if (!user_id) return errRes('缺少会员ID');
                const member = await db.prepare('SELECT id FROM users WHERE id=?').bind(user_id).first();
                if (!member) return errRes('会员不存在');
                await db.prepare('DELETE FROM balance_transactions WHERE user_id=?').bind(user_id).run();
                await db.prepare('DELETE FROM users WHERE id=?').bind(user_id).run();
                return jsonRes({ success: true });
            }

            // 重置会员密码
            if (path === '/api/admin/member/reset_password' && method === 'POST') {
                const { user_id, new_password } = await request.json();
                if (!user_id || !new_password) return errRes('参数不完整');
                if (new_password.length < 6) return errRes('新密码不能少于6位');
                if (new_password.length > 64) return errRes('新密码不能超过64位');
                const member = await db.prepare('SELECT id FROM users WHERE id=?').bind(user_id).first();
                if (!member) return errRes('会员不存在');
                const newHash = await hashPassword(new_password, env);
                const newEncrypted = await encryptPassword(new_password, env);
                await db.prepare('UPDATE users SET password_hash=?, password_encrypted=?, updated_at=? WHERE id=?').bind(newHash, newEncrypted, time(), user_id).run();
                return jsonRes({ success: true, message: '密码重置成功' });
            }

            // 冻结/解冻会员
            if (path === '/api/admin/member/freeze' && method === 'POST') {
                const { user_id, frozen } = await request.json();
                if (!user_id || frozen === undefined) return errRes('参数不完整');
                const member = await db.prepare('SELECT id FROM users WHERE id=?').bind(user_id).first();
                if (!member) return errRes('会员不存在');
                await db.prepare('UPDATE users SET frozen=?, updated_at=? WHERE id=?').bind(frozen ? 1 : 0, time(), user_id).run();
                return jsonRes({ success: true, frozen: frozen ? 1 : 0 });
            }

            // 设置会员等级
            if (path === '/api/admin/member/set_level' && method === 'POST') {
                const { user_id, member_level } = await request.json();
                if (user_id === undefined || member_level === undefined) return errRes('参数不完整');
                const newLv = parseInt(member_level);
                if (isNaN(newLv) || newLv < 0) return errRes('等级不能为负数');
                // [v1] 等级必须已在会员等级体系中配置，否则该会员会静默无折扣
                const lvlCheck2 = await validateMemberLevel(db, newLv);
                if (!lvlCheck2.ok) return errRes(lvlCheck2.error);
                const member = await db.prepare('SELECT id FROM users WHERE id=?').bind(user_id).first();
                if (!member) return errRes('会员不存在');
                // [v1] 管理员手动设定 = 最高优先级：写 level_source='manual'，
                //      自动升级规则从此【绝不】再改 member_level，直到管理员点「交还自动管理」。
                await db.prepare("UPDATE users SET member_level=?, level_source='manual', updated_at=? WHERE id=?").bind(newLv, time(), user_id).run();
                return jsonRes({ success: true, member_level: newLv, level_source: 'manual' });
            }

            // [v1] 设置自助充值限额（单笔 + 累计，0 = 不限）
            if (path === '/api/admin/member/recharge_limit' && method === 'POST') {
                const { user_id, limit_per_tx, limit_total } = await request.json();
                if (user_id === undefined) return errRes('缺少会员ID');
                const lp = (limit_per_tx === null || limit_per_tx === undefined || limit_per_tx === '') ? 0 : parseFloat(limit_per_tx);
                const lt = (limit_total === null || limit_total === undefined || limit_total === '') ? 0 : parseFloat(limit_total);
                if (isNaN(lp) || lp < 0 || isNaN(lt) || lt < 0) return errRes('充值限额必须是不小于 0 的数字（0 表示不限）');
                const member2 = await db.prepare('SELECT id FROM users WHERE id=?').bind(user_id).first();
                if (!member2) return errRes('会员不存在');
                await db.prepare('UPDATE users SET recharge_limit_per_tx=?, recharge_limit_total=?, updated_at=? WHERE id=?').bind(lp, lt, time(), user_id).run();
                return jsonRes({ success: true, recharge_limit_per_tx: lp, recharge_limit_total: lt });
            }

            // [v1] 交还自动管理：清除管理员手动锁定，让自动升级规则重新接管。
            //      语义：自动规则可继续【提升】等级，但不会降低已有等级（与历史行为一致）。
            if (path === '/api/admin/member/level_auto' && method === 'POST') {
                const { user_id } = await request.json();
                if (user_id === undefined) return errRes('缺少会员ID');
                const member3 = await db.prepare('SELECT id FROM users WHERE id=?').bind(user_id).first();
                if (!member3) return errRes('会员不存在');
                await db.prepare("UPDATE users SET level_source='auto', updated_at=? WHERE id=?").bind(time(), user_id).run();
                await applyAutoUpgrade(db, user_id);
                const after = await db.prepare('SELECT member_level, auto_level, level_source FROM users WHERE id=?').bind(user_id).first();
                return jsonRes({ success: true, member_level: after.member_level, auto_level: after.auto_level, level_source: after.level_source });
            }

            // ==================== [v3] 上游连接配置 + 自环防护 ====================
            // ⚠️ 硬规则：绝不允许把本站地址配成上游，否则会形成无限递归下单
            if (path === '/api/admin/upstream/connection/save' && method === 'POST') {
                await ensureApiTables(db);
                await ensureUpstreamConnTable(db);
                const { id, name, base_url, protocol, api_key, api_secret, enabled } = await request.json();
                if (!base_url) return errRes('缺少 base_url');
                let u;
                try { u = new URL(base_url); } catch(e) { return errRes('base_url 不是合法 URL'); }
                if (!/^https?:$/.test(u.protocol)) return errRes('base_url 必须是 http(s)');
                const upstreamHost = u.hostname.toLowerCase();
                const selfHosts = new Set();
                try { const sh = request.headers.get('Host'); if (sh) selfHosts.add(sh.split(':')[0].toLowerCase()); } catch(e) {}
                try {
                    const rows = (await db.prepare("SELECT key, value FROM site_config WHERE key IN ('site_domain','custom_domain')").all()).results || [];
                    rows.forEach(r => { if (r.value) selfHosts.add(String(r.value).replace(/^https?:\/\//, '').split('/')[0].split(':')[0].toLowerCase()); });
                } catch(e) {}
                if (selfHosts.has(upstreamHost)) {
                    return errRes('【已阻止】不能把本站地址配成上游，否则会形成无限递归下单：' + upstreamHost);
                }
                if (upstreamHost === 'localhost' || upstreamHost.endsWith('.local') || upstreamHost.endsWith('.internal') ||
                    /^127\./.test(upstreamHost) || /^10\./.test(upstreamHost) || /^192\.168\./.test(upstreamHost) ||
                    /^172\.(1[6-9]|2\d|3[01])\./.test(upstreamHost) || /^169\.254\./.test(upstreamHost) || upstreamHost === '::1' || upstreamHost === '0.0.0.0') {
                    return errRes('上游地址不能是内网/回环地址：' + upstreamHost);
                }
                const proto = ['dujiao-next', 'acg-faka', 'open-v1'].includes(protocol) ? protocol : 'open-v1';
                const now = time();
                if (id) {
                    await db.prepare('UPDATE upstream_connections SET name=?, base_url=?, protocol=?, api_key=?, api_secret=?, enabled=?, updated_at=? WHERE id=?')
                        .bind(name || upstreamHost, u.origin, proto, api_key || '', api_secret || '', enabled === false ? 0 : 1, now, id).run();
                    return jsonRes({ success: true, id });
                }
                const ins = await db.prepare('INSERT INTO upstream_connections (name, base_url, protocol, api_key, api_secret, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
                    .bind(name || upstreamHost, u.origin, proto, api_key || '', api_secret || '', enabled === false ? 0 : 1, now, now).run();
                return jsonRes({ success: true, id: ins.meta.last_row_id });
            }
            if (path === '/api/admin/upstream/connection/list') {
                await ensureUpstreamConnTable(db);
                const rows = (await db.prepare('SELECT id, name, base_url, protocol, api_key, enabled, last_sync_at, created_at, updated_at FROM upstream_connections ORDER BY id DESC').all()).results || [];
                return jsonRes({ connections: rows });
            }
            if (path === '/api/admin/upstream/connection/delete' && method === 'POST') {
                await ensureUpstreamConnTable(db);
                const { id } = await request.json();
                if (!id) return errRes('缺少连接 ID');
                await db.prepare('DELETE FROM upstream_connections WHERE id=?').bind(id).run();
                return jsonRes({ success: true });
            }

            // ==================== [v3+] 采购方适配器：sync 拉货 + purchase 自动补货 ====================
            // POST /api/admin/upstream/sync  { connection_id? }
            //   拉上游商品目录 → 建/更新本地商品与规格，并登记 upstream_items 映射。
            if (path === '/api/admin/upstream/sync' && method === 'POST') {
                await ensureUpstreamConnTable(db);
                let b = {};
                try { b = await request.json(); } catch (e) {}
                let conns = [];
                if (b.connection_id) {
                    const one = await db.prepare('SELECT * FROM upstream_connections WHERE id=?').bind(parseInt(b.connection_id)).first();
                    if (one) conns = [one];
                } else {
                    conns = (await db.prepare('SELECT * FROM upstream_connections WHERE enabled=1').all()).results || [];
                }
                if (!conns.length) return errRes('没有可用的上游连接');
                const summary = [];
                for (const conn of conns) {
                    const row = { connection_id: conn.id, name: conn.name, ping_ok: false, products: 0, skus: 0, created: 0, updated: 0, error: null };
                    if ((conn.protocol || 'dujiao-next') !== 'dujiao-next') {
                        row.error = '采购方客户端目前只支持 dujiao-next 协议，连接 ' + (conn.protocol || 'open-v1') + ' 请手动维护';
                        summary.push(row);
                        continue;
                    }
                    try {
                        const ping = await upstreamSignedFetch(conn, 'POST', '/api/v1/upstream/ping', {});
                        row.ping_ok = !!(ping.data && ping.data.ok);
                        if (!row.ping_ok) { row.error = (ping.data && ping.data.error_message) || ('ping 失败 HTTP ' + ping.status); summary.push(row); continue; }
                        let page = 1;
                        const maxPages = 20; // 安全阀：单次同步最多 20 页 × 100 条
                        while (page <= maxPages) {
                            const r = await upstreamSignedFetch(conn, 'GET', '/api/v1/upstream/products?page=' + page + '&page_size=100', null);
                            const items = (r.data && (r.data.items || (r.data.data && r.data.data.items))) || [];
                            if (!Array.isArray(items) || !items.length) break;
                            for (const it of items) {
                                row.products++;
                                const title = (typeof it.title === 'string') ? it.title
                                    : ((it.title && (it.title.zh_CN || Object.values(it.title)[0])) || ('上游商品 ' + it.id));
                                const skus = Array.isArray(it.skus) ? it.skus : [];
                                for (const sk of skus) {
                                    row.skus++;
                                    const extSku = String(sk.id);
                                    const map = await db.prepare('SELECT * FROM upstream_items WHERE connection_id=? AND upstream_sku_id=?')
                                        .bind(conn.id, extSku).first();
                                    const now2 = time();
                                    if (map && map.local_variant_id) {
                                        await db.prepare('UPDATE upstream_items SET name=?, price=?, stock=?, upstream_product_id=?, updated_at=? WHERE id=?')
                                            .bind(title + ' / ' + (sk.name || ''), parseFloat(sk.price_amount) || 0,
                                                parseInt(sk.stock_quantity) || 0, String(it.id), now2, map.id).run();
                                        row.updated++;
                                    } else {
                                        // 新上游 SKU：建本地商品（默认不对外开放，管理员手动开白名单）+ 规格
                                        const prodIns = await db.prepare('INSERT INTO products (category_id, name, description, sort, active, created_at, updated_at, member_price_enabled, api_enabled) VALUES (1, ?, ?, 0, 1, ?, ?, 1, 0)')
                                            .bind(title, '[上游代销] ' + title, now2, now2).run();
                                        const varIns = await db.prepare('INSERT INTO variants (product_id, name, price, stock, auto_delivery, created_at, updated_at, active) VALUES (?, ?, ?, 0, 1, ?, ?, 1)')
                                            .bind(prodIns.meta.last_row_id, sk.name || (title + ' ' + extSku), parseFloat(sk.price_amount) || 0, now2, now2).run();
                                        await db.prepare('INSERT INTO upstream_items (connection_id, upstream_product_id, upstream_sku_id, local_product_id, local_variant_id, name, price, stock, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
                                            .bind(conn.id, String(it.id), extSku, prodIns.meta.last_row_id, varIns.meta.last_row_id,
                                                title + ' / ' + (sk.name || ''), parseFloat(sk.price_amount) || 0,
                                                parseInt(sk.stock_quantity) || 0, now2, now2).run();
                                        row.created++;
                                    }
                                }
                            }
                            if (items.length < 100) break;
                            page++;
                        }
                        await db.prepare('UPDATE upstream_connections SET last_sync_at=? WHERE id=?').bind(time(), conn.id).run();
                    } catch (e) {
                        row.error = String((e && e.message) || e);
                    }
                    summary.push(row);
                }
                return jsonRes({ success: true, synced: summary });
            }

            // POST /api/admin/upstream/purchase  { connection_id, variant_id, qty }
            //   向上游下单采购卡密 → 自动入本地卡密库（自动补货）。卡密不可回收，入货后不支持自动退货。
            if (path === '/api/admin/upstream/purchase' && method === 'POST') {
                await ensureUpstreamConnTable(db);
                const b = await request.json();
                const connId = parseInt(b.connection_id) || 0;
                const variantId = parseInt(b.variant_id) || 0;
                const qty = parseInt(b.qty) || 0;
                if (!connId || !variantId) return errRes('缺少 connection_id / variant_id');
                if (qty < 1 || qty > 500) return errRes('采购数量需在 1-500 之间');
                const conn = await db.prepare('SELECT * FROM upstream_connections WHERE id=? AND enabled=1').bind(connId).first();
                if (!conn) return errRes('上游连接不存在或已禁用');
                if ((conn.protocol || 'dujiao-next') !== 'dujiao-next') return errRes('采购方客户端目前只支持 dujiao-next 协议');
                const map = await db.prepare('SELECT * FROM upstream_items WHERE connection_id=? AND local_variant_id=?').bind(connId, variantId).first();
                if (!map) return errRes('该本地规格未绑定上游 SKU，请先执行 sync');
                const skuId = parseInt(map.upstream_sku_id);
                if (!skuId) return errRes('上游 SKU ID 非法：' + map.upstream_sku_id);
                // 下单（downstream_order_no 幂等，防重复采购）
                const dsNo = ('buy-' + connId + '-' + variantId + '-' + time()).substring(0, 64);
                const od = await upstreamSignedFetch(conn, 'POST', '/api/v1/upstream/orders', {
                    sku_id: skuId, quantity: qty, downstream_order_no: dsNo, trace_id: 'admin_purchase'
                });
                const odData = od.data || {};
                if (!odData.ok) {
                    return errRes('上游下单失败：' + (odData.error_message || ('HTTP ' + od.status)));
                }
                // 查单取卡密（协议：创建订单响应不带 fulfillment）
                const detail = await upstreamSignedFetch(conn, 'GET', '/api/v1/upstream/orders/' + encodeURIComponent(odData.order_id), null);
                const d = detail.data || {};
                const payload = (d.fulfillment && d.fulfillment.payload) || '';
                const lines = String(payload).split('\n').map(s => s.trim()).filter(Boolean);
                let imported = 0;
                const now3 = time();
                for (const line of lines) {
                    const ins = await db.prepare('INSERT INTO cards (variant_id, content, status, order_id, created_at) VALUES (?, ?, 0, NULL, ?)')
                        .bind(variantId, line, now3).run();
                    if (ins.success) imported++;
                }
                // [修复] 上游拉回卡密后必须回写本地库存并推高变更时间，
                //        否则本地 stock 一直是 0，且下游 updated_after 增量同步看不到新货。
                if (imported > 0) {
                    await db.prepare("UPDATE variants SET stock = (SELECT COUNT(*) FROM cards WHERE variant_id=? AND status=0), updated_at=? WHERE id = ?")
                        .bind(variantId, now3, variantId).run();
                    await touchProductsByVariant(db, variantId);
                }
                await db.prepare('UPDATE upstream_items SET stock=?, updated_at=? WHERE id=?')
                    .bind(parseInt(map.stock) || 0, now3, map.id).run();
                return jsonRes({
                    success: true,
                    upstream_order_no: odData.order_no || null,
                    upstream_status: d.status || odData.status || 'unknown',
                    requested: qty,
                    imported,
                    note: imported === 0 ? '上游未返回卡密内容，请到查单确认发货状态' : '卡密已入本地库存（未售出状态）'
                });
            }

            // ==================== [v2] API Key 管理 ====================
            // ⚠️ api_secret 仅在 generate 时返回一次，之后任何接口都不再回显

            // 查询凭证（不回显 secret）
            if (path === '/api/admin/member/apikey/get') {
                await ensureApiTables(db);
                const uid = parseInt(url.searchParams.get('user_id') || url.searchParams.get('id'));
                if (!uid) return errRes('缺少会员ID');
                const cred = await db.prepare('SELECT * FROM api_credentials WHERE user_id=?').bind(uid).first();
                if (!cred) return jsonRes({ exists: false });
                let wl = [];
                try { wl = cred.callback_whitelist ? JSON.parse(cred.callback_whitelist) : []; } catch(e) {}
                return jsonRes({
                    exists: true,
                    id: cred.id, user_id: cred.user_id, api_key: cred.api_key,
                    status: cred.status, is_active: cred.is_active === 1,
                    rate_limit_per_min: cred.rate_limit_per_min, price_mode: cred.price_mode || 'member',
                    scopes: cred.scopes || '',
                    allow_callback: cred.allow_callback === 1, callback_whitelist: wl,
                    reject_reason: cred.reject_reason || '',
                    last_used_at: cred.last_used_at, created_at: cred.created_at, updated_at: cred.updated_at
                });
            }

            // 生成 / 重置（唯一返回明文 secret 的入口）
            if (path === '/api/admin/member/apikey/generate' && method === 'POST') {
                await ensureApiTables(db);
                const { user_id, regenerate } = await request.json();
                if (user_id === undefined) return errRes('缺少会员ID');
                const m = await db.prepare('SELECT id, email, username FROM users WHERE id=?').bind(user_id).first();
                if (!m) return errRes('会员不存在');
                const now = time();
                const existing = await db.prepare('SELECT id, api_key FROM api_credentials WHERE user_id=?').bind(user_id).first();
                const newKey = existing && !regenerate ? existing.api_key : genApiKey();
                const newSecret = genApiSecret();
                if (existing) {
                    await db.prepare('UPDATE api_credentials SET api_key=?, api_secret=?, status=?, is_active=1, reject_reason=NULL, updated_at=? WHERE user_id=?')
                        .bind(newKey, newSecret, 'approved', now, user_id).run();
                } else {
                    await db.prepare('INSERT INTO api_credentials (user_id, api_key, api_secret, status, is_active, rate_limit_per_min, price_mode, allow_callback, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 60, ?, 1, ?, ?)')
                        .bind(user_id, newKey, newSecret, 'approved', 'member', now, now).run();
                }
                return jsonRes({
                    success: true, user_id, api_key: newKey, api_secret: newSecret,
                    warning: '请立即复制并妥善保管 api_secret，此值仅显示一次，关闭后无法再次查看；若丢失请重新生成。'
                });
            }

            // 更新配置（状态/限流/计价/回调白名单）
            if (path === '/api/admin/member/apikey/update' && method === 'POST') {
                await ensureApiTables(db);
                const { user_id, is_active, status, rate_limit_per_min, price_mode, allow_callback, callback_whitelist, reject_reason, scopes } = await request.json();
                if (user_id === undefined) return errRes('缺少会员ID');
                const cred = await db.prepare('SELECT * FROM api_credentials WHERE user_id=?').bind(user_id).first();
                if (!cred) return errRes('该会员尚未生成 API Key');
                const now = time();
                const nextActive = (is_active === undefined) ? cred.is_active : (is_active ? 1 : 0);
                const nextStatus = status !== undefined ? String(status) : cred.status;
                if (!['approved', 'pending_review', 'rejected', 'disabled'].includes(nextStatus)) return errRes('status 取值非法');
                const nextRate = rate_limit_per_min !== undefined ? (parseInt(rate_limit_per_min) || 0) : cred.rate_limit_per_min;
                if (nextRate < 0 || nextRate > 10000) return errRes('限流需在 0-10000 之间（0 = 不限）');
                const nextMode = price_mode !== undefined ? String(price_mode) : (cred.price_mode || 'member');
                if (!['member', 'fixed_member', 'list'].includes(nextMode)) return errRes('price_mode 只支持 member / fixed_member / list');
                const nextCb = (allow_callback === undefined) ? cred.allow_callback : (allow_callback ? 1 : 0);
                let nextWl = cred.callback_whitelist;
                if (callback_whitelist !== undefined) {
                    const arr = Array.isArray(callback_whitelist) ? callback_whitelist
                        : String(callback_whitelist || '').split(/[\n,]/).map(s => s.trim()).filter(Boolean);
                    if (arr.length > 20) return errRes('回调白名单最多 20 条');
                    for (const u of arr) {
                        if (!/^https?:\/\//i.test(u)) return errRes('回调白名单必须是 http(s) 地址：' + u);
                    }
                    nextWl = arr.length ? JSON.stringify(arr) : null;
                }
                // [v3+] scopes：空 = 全部开放；否则白名单校验取值
                let nextScopes = cred.scopes || '';
                if (scopes !== undefined) {
                    const arr2 = Array.isArray(scopes) ? scopes
                        : String(scopes || '').split(/[\s,]+/).filter(Boolean);
                    const allowed = ['catalog:read', 'order:read', 'order:write', '*'];
                    for (const s of arr2) if (!allowed.includes(s)) return errRes('scopes 取值非法：' + s + '（可选 catalog:read / order:read / order:write / *）');
                    if (arr2.length > 10) return errRes('scopes 最多 10 项');
                    nextScopes = arr2.length ? JSON.stringify(arr2) : '';
                }
                await db.prepare('UPDATE api_credentials SET is_active=?, status=?, rate_limit_per_min=?, price_mode=?, allow_callback=?, callback_whitelist=?, reject_reason=?, scopes=?, updated_at=? WHERE user_id=?')
                    .bind(nextActive, nextStatus, nextRate, nextMode, nextCb, nextWl, reject_reason || null, nextScopes, now, user_id).run();
                return jsonRes({ success: true });
            }

            // 吊销（删凭证，会员可重新生成）
            if (path === '/api/admin/member/apikey/revoke' && method === 'POST') {
                await ensureApiTables(db);
                const { user_id } = await request.json();
                if (user_id === undefined) return errRes('缺少会员ID');
                const del = await db.prepare('DELETE FROM api_credentials WHERE user_id=?').bind(user_id).run();
                return jsonRes({ success: true, revoked: !!(del.success && del.meta.changes > 0) });
            }

            // 调用日志
            if (path === '/api/admin/member/apilog/list') {
                await ensureApiTables(db);
                const uid = parseInt(url.searchParams.get('user_id') || url.searchParams.get('id'));
                const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get('limit')) || 50));
                const rows = uid
                    ? (await db.prepare('SELECT * FROM api_call_logs WHERE user_id=? ORDER BY id DESC LIMIT ?').bind(uid, limit).all()).results || []
                    : (await db.prepare('SELECT * FROM api_call_logs ORDER BY id DESC LIMIT ?').bind(limit).all()).results || [];
                return jsonRes({ logs: rows });
            }
        }
        // ===========================
        // --- 公开 API (Shop) ---
        // ===========================
        if (path === '/api/shop/config') {
            const res = await db.prepare("SELECT * FROM site_config").all();
            const allConfig = {}; 
            if (res.results) res.results.forEach(r => allConfig[r.key] = r.value);
            const publicKeys = [
                'site_favicon', 'mobile_sidebar_logo', 'mobile_sidebar_logo_link',
                'site_name', 'site_logo', 'show_site_name', 'show_site_logo', 
                'theme', 'announce', 'contact_info', 'site_description',
                'footer_html', 'tg_active', 'outlook_active', 'custom_js',
                'admin_turnstile_active', 'turnstile_site_key', 'admin_captcha_active',
                'member_enabled', 'member_levels', 'member_upgrade_rules'
            ];
            const safeConfig = {};
            publicKeys.forEach(key => {
                if (allConfig[key] !== undefined) {
                    safeConfig[key] = allConfig[key];
                }
            });
            // 默认开启图形验证码（数据库未设置时视为开启）
            if (safeConfig.admin_captcha_active === undefined) safeConfig.admin_captcha_active = '1';

            return jsonRes(safeConfig);
        }
       // ====== [开始] 新增代码：获取启用的支付方式 ======
        if (path === '/api/shop/gateways') {
            await ensurePayGatewayColumns(db);
            // 获取所有 active=1 的支付网关，并取出 ID；for=recharge 时仅返回开启"会员充值"开关的网关
            const forRecharge = url.searchParams.get('for') === 'recharge';
            const sql = forRecharge
                ? "SELECT id, name, type, config FROM pay_gateways WHERE active = 1 AND member_recharge = 1 ORDER BY sort DESC, id ASC"
                : "SELECT id, name, type, config FROM pay_gateways WHERE active = 1 ORDER BY sort DESC, id ASC";
            const { results } = await db.prepare(sql).all();
            // 过滤敏感信息，仅返回前端所需的 id, name, type 和自定义 icon
            const gateways = results.map(g => {
                let icon = '';
                try { icon = JSON.parse(g.config).icon || ''; } catch(e){}
                return { id: g.id, name: g.name, type: g.type, icon: icon };
            });
            return jsonRes(gateways);
        }
        // ====== [结束] 新增代码 ======
        // [新增] 获取所有分类 (公开)
        if (path === '/api/shop/categories') {
            const { results } = await db.prepare("SELECT * FROM categories ORDER BY sort DESC, id DESC").all();
            return jsonRes(results);
        }

        // [修改] 首页商品接口性能优化 (批量查询)
        if (path === '/api/shop/products') {
            // 1. 获取所有上架商品
            const res = (await db.prepare("SELECT * FROM products WHERE active=1 ORDER BY sort DESC").all()).results;
            
            if (res.length > 0) {
                // 2. [性能优化] 批量获取所有相关规格，避免 N+1 循环查询导致的速度慢
                // 提取所有商品的 ID
                const ids = res.map(p => p.id).join(',');
                
                // 一次性查出所有涉及的规格
                const allVariants = (await db.prepare(`SELECT * FROM variants WHERE product_id IN (${ids})`).all()).results;
                
                // 在内存中将规格按 product_id 分组
                const variantsMap = {};
                allVariants.forEach(v => {
                    // 解析批发配置
                    if (v.wholesale_config) {
                         try { v.wholesale_config = JSON.parse(v.wholesale_config); } catch(e) { v.wholesale_config = null; }
                    }
                    
                    if (!variantsMap[v.product_id]) {
                        variantsMap[v.product_id] = [];
                    }
                    variantsMap[v.product_id].push(v);
                });

                // 3. 将规格挂载到对应商品对象上
                for(let p of res) {
                    p.variants = variantsMap[p.id] || [];
                }
            }
            
            // [统一口径] 会员请求时返回预计算会员价（游客/无折扣不返回）
            const mlUser = await memberAuth(request, env, db);
            if (mlUser) {
                const mlDiscount = await resolveMemberDiscount(db, mlUser.member_level);
                for (const p of res) attachMemberPricing(p, p.variants || [], mlDiscount);
            }
            return jsonRes(res);
        }
        
        // [修复] 获取单个商品详情 (修复 404 问题)
        if (path === '/api/shop/product') {
            const id = url.searchParams.get('id');
            if (!id) return errRes('参数错误：缺少商品ID');

            // 1. 获取商品主信息
            const product = await db.prepare("SELECT * FROM products WHERE id = ? AND active=1").bind(id).first();
            if (!product) return errRes('商品不存在或已下架', 404);

            // 2. 获取规格信息
            const variants = (await db.prepare("SELECT * FROM variants WHERE product_id = ? AND active = 1 ORDER BY sort DESC, id ASC").bind(id).all()).results;
            
            // 3. 解析批发配置和数字类型
            variants.forEach(v => {
                if (v.wholesale_config) {
                     try { v.wholesale_config = JSON.parse(v.wholesale_config); } catch(e) { v.wholesale_config = null; }
                }
                // 强制转换为数字，防止前端判断出错
                v.custom_markup = Number(v.custom_markup || 0);
                v.auto_delivery = Number(v.auto_delivery);
            });

            product.variants = variants;
            // [统一口径] 会员请求时返回预计算会员价（游客/无折扣不返回）
            const mpUser = await memberAuth(request, env, db);
            if (mpUser) attachMemberPricing(product, variants, await resolveMemberDiscount(db, mpUser.member_level));
            return jsonRes(product);
        }

        // =============================================
        // === [新增] 文章系统前端 API 升级 ===
        // =============================================

        // [新增] 获取文章分类 (公开)
        if (path === '/api/shop/article/categories') {
            const { results } = await db.prepare("SELECT * FROM article_categories ORDER BY sort DESC, id DESC").all();
            return jsonRes(results);
        }

        // [升级] 获取文章列表 (含摘要、首图、置顶、浏览量)
        if (path === '/api/shop/articles/list') {
            // 修改点：增加查询 a.cover_image 字段
            const { results } = await db.prepare(`
                SELECT a.id, a.title, a.content, a.created_at, a.is_notice, a.view_count, a.category_id, a.cover_image, a.seo_description, ac.name as category_name
                FROM articles a
                LEFT JOIN article_categories ac ON a.category_id = ac.id
                ORDER BY a.is_notice DESC, a.view_count DESC, a.created_at DESC
            `).all();
            
            // 处理数据
            const processed = results.map(r => {
                const contentStr = r.content || '';
                // 1. 提取纯文本摘要 (去标签)
                const text = contentStr.replace(/<[^>]+>/g, '');
                // 2. 提取第一张图片 (作为备选)
                const imgMatch = contentStr.match(/<img[^>]+src="([^">]+)"/);
                
                return {
                    id: r.id,
                    title: r.title,
                    category_name: r.category_name || '默认分类',
                    category_id: r.category_id,
                    created_at: r.created_at,
                    is_notice: r.is_notice,
                    view_count: r.view_count || 0,
                    // 修改点：返回后台设置的封面图，如果没有设置，则自动使用文章内第一张图
                    cover_image: r.cover_image || (imgMatch ? imgMatch[1] : null),
                    // 修改点：返回后端处理好的摘要 snippet
                    snippet: r.seo_description || (text.substring(0, 100) + (text.length > 100 ? '...' : ''))
                };
            });
            return jsonRes(processed);
        }

        if (path === '/api/shop/article/get') {
            const id = url.searchParams.get('id');
            await db.prepare("UPDATE articles SET view_count = view_count + 1 WHERE id = ?").bind(id).run();
            const article = await db.prepare(`
                SELECT a.*, ac.name as category_name
                FROM articles a
                LEFT JOIN article_categories ac ON a.category_id = ac.id
                WHERE a.id = ?
            `).bind(id).first();
            return jsonRes(article || { error: 'Not Found' });
        }

        // [新增] 获取自定义单页内容
        if (path === '/api/shop/page/get') {
            const alias = url.searchParams.get('alias');
            const page = await db.prepare("SELECT title, content, seo_description, updated_at FROM pages WHERE alias = ?").bind(alias).first();
            return jsonRes(page || { error: 'Not Found' });
        }

        // [新增] 获取自选卡密列表 (提取 #[] 内容)
        if (path === '/api/shop/cards/notes') {
            const variant_id = url.searchParams.get('variant_id');
            const cards = await db.prepare("SELECT id, content FROM cards WHERE variant_id=? AND status=0 LIMIT 100").bind(variant_id).all();
            const notes = cards.results.map(c => {
                const match = c.content.match(/#\[(.*?)\]/);
                if (match) {
                    return { id: c.id, note: match[1] };
                }
                return null;
            }).filter(n => n !== null);
            
            return jsonRes(notes);
        }

        // ===========================
        // --- 会员 API (Member) ---
        // ===========================

        // === 会员验证码生成接口 (频率限制: 每IP每分钟最多10次) ===
        if (path === '/api/member/captcha') {
            const clientIP = getClientIP(request);
            const captchaRateKey = `captcha_rate_${clientIP}`;
            const nowTs = Math.floor(Date.now() / 1000);
            const windowSeconds = 60;
            const maxRequests = 10;
            try {
                // [C优化] 建表只在本实例首次执行，省掉每请求一次往返
                if (!_rateLimitsTableReady) {
                    await db.prepare('CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, count INTEGER DEFAULT 1, first_attempt INTEGER NOT NULL)').run();
                    _rateLimitsTableReady = true;
                }
                // [C优化] 将"查计数+加计数"合并为单条 upsert...RETURNING，再省一次往返；
                // 规则不变：同一 IP 60 秒内最多 10 次，超出即 429（防护完全保留）
                const windowStart = nowTs - windowSeconds;
                const rl = await db.prepare(
                    "INSERT INTO rate_limits (key, count, first_attempt) VALUES (?, 1, ?) " +
                    "ON CONFLICT(key) DO UPDATE SET " +
                    "count = CASE WHEN first_attempt <= ? THEN 1 ELSE count + 1 END, " +
                    "first_attempt = CASE WHEN first_attempt <= ? THEN ? ELSE first_attempt END " +
                    "RETURNING count, first_attempt"
                ).bind(captchaRateKey, nowTs, windowStart, windowStart, nowTs).all();
                let row = rl.results && rl.results[0];
                if (!row) {
                    // 兼底：万一 RETURNING 未回传，退回一次 SELECT，确保限流仍生效（不静默失效）
                    row = await db.prepare('SELECT count, first_attempt FROM rate_limits WHERE key=?').bind(captchaRateKey).first();
                }
                if (row && row.count > maxRequests) {
                    const remain = windowSeconds - (nowTs - row.first_attempt);
                    return errRes('验证码请求过于频繁，请 ' + remain + ' 秒后重试', 429);
                }
            } catch(e) { console.error('Captcha rate limit error:', e); }
            // [安全加固·M4修复] 答案存服务端，一次性令牌校验
            return jsonRes(await createCaptcha(db));
        }

        // 会员注册
        if (path === '/api/member/register' && method === 'POST') {
            // [会员系统开关] 后台关闭"开启会员系统"时禁止新注册；已注册会员仍可正常登录
            try {
                const regEnabledRow = await db.prepare("SELECT value FROM site_config WHERE key='member_enabled'").first();
                if (!regEnabledRow || regEnabledRow.value !== '1') return errRes('会员系统未开启，暂不开放注册', 403);
            } catch (e) { console.error('member_enabled check error:', e); return errRes('会员系统未开启，暂不开放注册', 403); }
            const { username, password, email, captchaText, captchaHash, captchaExpire } = await request.json();
            const regEmail = email || username; // 兼容前端传 username 字段（实际已是邮箱）
            if (!regEmail || !password) return errRes('邮箱和密码不能为空');
            // 验证码校验（服务端一次性令牌）
            if (!(await verifyCaptcha(db, captchaText, captchaHash, captchaExpire))) return errRes('图形验证码错误或已过期，请刷新重试');
            // [安全加固·H1修复] 邮箱白名单字符，防止引号/尖括号等进入后台 HTML/JS 上下文
            if (!/^[A-Za-z0-9._%+\-\u4e00-\u9fa5]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/.test(regEmail)) return errRes('请输入有效的邮箱地址');
            if (password.length < 6) return errRes('密码不能少于6位');
            if (password.length > 64) return errRes('密码不能超过64位');
            const existing = await db.prepare('SELECT id FROM users WHERE email=?').bind(regEmail).first();
            if (existing) return errRes('该邮箱已注册');
            const passwordHash = await hashPassword(password, env);
            const passwordEncrypted = await encryptPassword(password, env);
            const now = time();
            // 自动生成序号用户名（001, 002, 003...）
            const maxRow = await db.prepare("SELECT username FROM users WHERE username GLOB '[0-9]*' ORDER BY CAST(username AS INTEGER) DESC LIMIT 1").first();
            const nextNum = maxRow ? (parseInt(maxRow.username, 10) || 0) + 1 : 1;
            const autoUsername = String(nextNum).padStart(3, '0');
            // 列/索引兼容已由 ensureMemberTables 统一处理，不再逐请求 ALTER
            const result = await db.prepare('INSERT INTO users (username, password_hash, password_encrypted, email, balance, frozen, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 0, ?, ?)').bind(autoUsername, passwordHash, passwordEncrypted, regEmail, now, now).run();
            const userId = result.meta.last_row_id;
            const token = await generateToken(userId, env);
            return jsonRes({ token, user: { id: userId, username: autoUsername, email: regEmail, balance: 0 } });
        }

        // 会员登录 (含频率限制 + 密码哈希升级 + 验证码)
        if (path === '/api/member/login' && method === 'POST') {
            const clientIP = getClientIP(request);
            const { username, password, captchaText, captchaHash, captchaExpire } = await request.json();
            const loginEmail = username; // 前端传来的邮箱（字段名保持 username 兼容）
            if (!loginEmail || !password) return errRes('邮箱和密码不能为空');
            // 验证码校验（服务端一次性令牌）
            if (!(await verifyCaptcha(db, captchaText, captchaHash, captchaExpire))) return errRes('图形验证码错误或已过期，请刷新重试');

            // [安全加固] 频率限制: 5分钟内最多5次失败
            try { await db.prepare('CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, count INTEGER DEFAULT 1, first_attempt INTEGER NOT NULL)').run(); } catch(e) {}
            const rateLimitKey = `member_login_fail_${clientIP}`;
            let rateInfo = null;
            try {
                const row = await db.prepare('SELECT count, first_attempt FROM rate_limits WHERE key=?').bind(rateLimitKey).first();
                if (row) rateInfo = row;
            } catch(e) {}
            const nowTs = Math.floor(Date.now() / 1000);
            const windowSeconds = 300;
            const maxAttempts = 5;
            if (rateInfo && (nowTs - rateInfo.first_attempt) < windowSeconds && rateInfo.count >= maxAttempts) {
                const remainSeconds = windowSeconds - (nowTs - rateInfo.first_attempt);
                return errRes(`登录失败次数过多，请 ${remainSeconds} 秒后重试`, 429);
            }

            // 优先用邮箱查找，兼容旧用户名登录
            let user = await db.prepare('SELECT id, username, email, balance, password_hash, frozen FROM users WHERE email=?').bind(loginEmail).first();
            if (!user) {
                // 兼容旧数据：用用户名查找
                user = await db.prepare('SELECT id, username, email, balance, password_hash, frozen FROM users WHERE username=?').bind(loginEmail).first();
            }
            const passwordValid = user ? await verifyPassword(password, user.password_hash, env) : false;
            if (!passwordValid) {
                // 记录失败次数
                try {
                    if (!rateInfo || (nowTs - rateInfo.first_attempt) >= windowSeconds) {
                        await db.prepare("INSERT INTO rate_limits (key, count, first_attempt) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count=1, first_attempt=excluded.first_attempt").bind(rateLimitKey, nowTs).run();
                    } else {
                        await db.prepare("UPDATE rate_limits SET count=count+1 WHERE key=?").bind(rateLimitKey).run();
                    }
                } catch(e) {}
                return errRes('邮箱或密码错误');
            }

            // 登录成功: 清除失败记录 + 升级旧哈希
            // [新增] 检查账户是否被冻结
            if (user.frozen === 1) return errRes('该账户已被冻结，请联系客服');
            try { await db.prepare('DELETE FROM rate_limits WHERE key = ?').bind(rateLimitKey).run(); } catch(e) {}
            if (needsHashUpgrade(user.password_hash)) {
                try {
                    const newHash = await hashPassword(password, env);
                    await db.prepare('UPDATE users SET password_hash=? WHERE id=?').bind(newHash, user.id).run();
                } catch(e) {}
            }
            const token = await generateToken(user.id, env);
            return jsonRes({ token, user: { id: user.id, username: user.username, email: user.email, balance: user.balance } });
        }

        // 获取会员信息
        if (path === '/api/member/profile' && method === 'GET') {
            const user = await memberAuth(request, env, db);
            if (!user) return errRes('请先登录', 401);
            return jsonRes({ user });
        }

        // 会员充值（创建充值订单）
        if (path === '/api/member/recharge' && method === 'POST') {
            const user = await memberAuth(request, env, db);
            if (!user) return errRes('请先登录', 401);
            if (user.frozen === 1) return errRes('账户已被冻结，无法充值，请联系客服', 403);
            const { amount, payment_method } = await request.json();
            const amt = parseFloat(amount);
            if (!amt || isNaN(amt)) return errRes('充值金额格式不正确');
            if (amt < 1) return errRes('充值金额最低1元');
            if (!payment_method) return errRes('请选择支付方式');

            // === [v1] 自助充值限额校验 ===
            // ⚠️ 铁律：只在【建单前】校验，绝不在支付回调里拦——否则用户已付款却不入账，是资损事故。
            const maxRow = await db.prepare("SELECT value FROM site_config WHERE key='recharge_max_per_tx'").first();
            // 0 = 不限（与会员个人限额口径一致）；未配置时用 10000 兜底
            const gv = (maxRow && maxRow.value !== undefined && maxRow.value !== null && maxRow.value !== '')
                ? (parseFloat(maxRow.value) || 0) : 10000;
            const perTx = parseFloat(user.recharge_limit_per_tx) || 0;
            // 全局上限 与 会员个人单笔限额 取小者（0 = 不限，不参与取小）
            const cands = [gv, perTx].filter(v => v > 0);
            const cap = cands.length ? Math.min.apply(null, cands) : 0;
            if (cap > 0 && amt > cap) {
                return errRes((perTx > 0 && perTx === cap)
                    ? '单笔自助充值不能超过 ' + cap + ' 元，大额充值请联系管理员线下入账'
                    : '单次充值不能超过 ' + cap + ' 元', 403);
            }
            const limitTotal = parseFloat(user.recharge_limit_total) || 0;
            if (limitTotal > 0) {
                const already = parseFloat(user.total_recharge) || 0;
                if (already + amt > limitTotal) {
                    return errRes('累计自助充值已达上限 ' + limitTotal + ' 元（已用 ' + already.toFixed(2) + '），大额充值请联系管理员线下入账', 403);
                }
            }
            // 校验支付方式必须开启了"会员充值"开关
            await ensurePayGatewayColumns(db);
            const rechargeGw = await db.prepare("SELECT id FROM pay_gateways WHERE id=? AND active=1 AND member_recharge=1").bind(payment_method).first()
                || await db.prepare("SELECT id FROM pay_gateways WHERE type=? AND active=1 AND member_recharge=1").bind(payment_method).first();
            if (!rechargeGw) return errRes('该支付方式未开启会员充值或不可用');
            const order_id = uuid();
            const now = time();
            const contact = user.email || user.username;
            await db.prepare('INSERT INTO orders (id, variant_id, product_name, variant_name, price, quantity, total_amount, contact, query_password, payment_method, created_at, status, user_id) VALUES (?, 0, ?, ?, ?, 1, ?, ?, ?, ?, ?, 0, ?)').bind(order_id, '会员充值', '充值' + amt + '元', amt, amt.toFixed(2), contact, 'balance_recharge', payment_method, now, user.id).run();
            return jsonRes({ order_id, total_amount: amt.toFixed(2), payment_method });
        }

        // 余额支付 (原子扣减)
        if (path === '/api/member/balance_pay' && method === 'POST') {
            const user = await memberAuth(request, env, db);
            if (!user) return errRes('请先登录', 401);
            if (user.frozen === 1) return errRes('账户已被冻结，无法使用余额支付，请联系客服', 403);
            const { order_id } = await request.json();
            if (!order_id) return errRes('缺少订单号');
            const order = await db.prepare('SELECT * FROM orders WHERE id=? AND status=0').bind(order_id).first();
            if (!order) return errRes('订单不存在或已支付');
            // 检查订单归属
            if (order.user_id !== user.id && order.contact !== (user.email || user.username)) {
                return errRes('无权操作此订单');
            }
            // [新增] 购物车订单：扣款前预检库存，缺货直接报错不扣钱
            if (order.variant_id === 0) {
                try {
                    const cartItems = JSON.parse(order.cards_sent || '[]');
                    const outOfStockItems = [];
                    for (const item of cartItems) {
                        if (!item.variantId) continue;
                        const variant = await db.prepare('SELECT auto_delivery, name FROM variants WHERE id=?').bind(item.variantId).first();
                        if (!variant) {
                            outOfStockItems.push(item.productName + ' - ' + item.variantName + '（商品已下架）');
                            continue;
                        }
                        if (variant.auto_delivery === 1) {
                            let available = 0;
                            if (item.buyMode === 'select' && item.selectedCardId) {
                                const card = await db.prepare('SELECT id FROM cards WHERE id=? AND variant_id=? AND status=0').bind(item.selectedCardId, item.variantId).first();
                                available = card ? 1 : 0;
                            } else {
                                available = (await db.prepare('SELECT COUNT(*) as c FROM cards WHERE variant_id=? AND status=0').bind(item.variantId).first()).c;
                            }
                            if (available < item.quantity) {
                                outOfStockItems.push(item.productName + ' - ' + item.variantName + '（库存不足，仅剩' + available + '件）');
                            }
                        } else {
                            if (variant.stock < item.quantity) {
                                outOfStockItems.push(item.productName + ' - ' + item.variantName + '（库存不足，仅剩' + variant.stock + '件）');
                            }
                        }
                    }
                    if (outOfStockItems.length > 0) {
                        return errRes('以下商品库存不足，请返回购物车删除后再付款：\n' + outOfStockItems.join('\n'));
                    }
                } catch (e) {
                    console.error('Cart stock pre-check error:', e);
                }
            }
            // [安全加固·H2修复] 先原子占用订单（置为 status=9 处理中），并发请求只有一个能拿到，防重复扣款/重复发货
            const claimRes = await db.prepare('UPDATE orders SET status=9 WHERE id=? AND status=0').bind(order_id).run();
            if (!claimRes.success || claimRes.meta.changes !== 1) {
                return errRes('订单正在处理中或已支付，请刷新后查看订单状态', 409);
            }
            // [安全加固] 原子扣减余额 (防止并发导致负数)
            let deductApplied = false;
            let newBalance;
            try {
            const deductRes = await db.prepare('UPDATE users SET balance = balance - ?, updated_at = ? WHERE id = ? AND balance >= ?').bind(order.total_amount, time(), user.id, order.total_amount).run();
            if (!deductRes.success || deductRes.meta.changes !== 1) {
                // 余额不足：释放订单占用，恢复为待支付
                await db.prepare('UPDATE orders SET status=0 WHERE id=? AND status=9').bind(order_id).run();
                const currentBalance = (await db.prepare('SELECT balance FROM users WHERE id=?').bind(user.id).first()).balance || 0;
                return errRes('余额不足，当前余额：' + currentBalance.toFixed(2) + '元');
            }
            deductApplied = true;
            newBalance = (await db.prepare('SELECT balance FROM users WHERE id=?').bind(user.id).first()).balance;
            // [v1] 已移除「消费后自动升级检查」：消费不改变 total_incoming（累计入金），
            //      升级判定只在【入金发生后】触发（三个支付回调 + 管理员手动加余额）。
            // 更新订单状态（仅当仍处于处理中，幂等保护）
            await db.prepare('UPDATE orders SET status=1, paid_at=? WHERE id=? AND status=9').bind(time(), order_id).run();
            } catch (e) {
                // [安全加固·H2修复] 异常回滚：先确认订单未被标记为已支付，再退还余额并释放占用
                // （防止 status=1 已写入但响应中断导致误退款）
                let alreadyPaid = false;
                try {
                    const cur = await db.prepare('SELECT status FROM orders WHERE id=?').bind(order_id).first();
                    alreadyPaid = !!(cur && cur.status === 1);
                } catch(e2) {}
                if (!alreadyPaid) {
                    if (deductApplied) {
                        try { await db.prepare('UPDATE users SET balance = balance + ?, updated_at = ? WHERE id = ?').bind(order.total_amount, time(), user.id).run(); } catch(e2) { console.error('Refund on error failed:', e2); }
                    }
                    try { await db.prepare('UPDATE orders SET status=0 WHERE id=? AND status=9').bind(order_id).run(); } catch(e2) { console.error('Release claim on error failed:', e2); }
                }
                throw e;
            }
            // 记录余额变动 (容错：不影响主流程)
            try {
                await db.prepare('INSERT INTO balance_transactions (user_id, amount, type, description, order_id, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(user.id, -order.total_amount, 'order_payment', '订单支付 ' + order_id, order_id, time()).run();
            } catch(e) { console.error('Balance transaction log error:', e); }
            // 处理自动发货（支持单商品订单 + 购物车合并订单）
            let cardsContent = [];
            if (order.variant_id === 0) {
                // === 购物车合并订单：逐个商品发货 ===
                try {
                    const cartItems = JSON.parse(order.cards_sent || '[]');
                    let newOrderStatus = 2;
                    for (const item of cartItems) {
                        if (!item.variantId) continue;
                        const variant = await db.prepare('SELECT auto_delivery FROM variants WHERE id=?').bind(item.variantId).first();
                        if (!variant) continue;
                        if (variant.auto_delivery === 1) {
                            let cards;
                            if (item.buyMode === 'select' && item.selectedCardId) {
                                cards = await db.prepare('UPDATE cards SET status=1, order_id=? WHERE id=? AND status=0 RETURNING id, content').bind(order_id, item.selectedCardId).all();
                            } else {
                                cards = await db.prepare('UPDATE cards SET status=1, order_id=? WHERE id IN (SELECT id FROM cards WHERE variant_id=? AND status=0 LIMIT ?) RETURNING id, content').bind(order_id, item.variantId, item.quantity).all();
                            }
                            if (cards.results.length >= item.quantity) {
                                const itemCards = cards.results.map(c => `【${item.productName} - ${item.variantName}】\n${stripCardNote(c.content)}`);
                                cardsContent.push(...itemCards);
                                await db.prepare('UPDATE variants SET sales_count = sales_count + ? WHERE id=?').bind(item.quantity, item.variantId).run();
                                await db.prepare('UPDATE variants SET stock = (SELECT COUNT(*) FROM cards WHERE variant_id=? AND status=0) WHERE id=?').bind(item.variantId, item.variantId).run();
                            } else {
                                newOrderStatus = 1;
                            }
                        } else {
                            const stockUpdate = await db.prepare('UPDATE variants SET stock = stock - ?, sales_count = sales_count + ? WHERE id=? AND stock >= ?').bind(item.quantity, item.quantity, item.variantId, item.quantity).run();
                            cardsContent.push(`【${item.productName} - ${item.variantName}】\n该商品为手动发货，已通知客服为您排单处理。`);
                            newOrderStatus = 1;
                        }
                    }
                    if (cardsContent.length > 0) {
                        await db.prepare('UPDATE orders SET status=?, cards_sent=? WHERE id=?').bind(newOrderStatus, JSON.stringify(cardsContent), order_id).run();
                    }
                } catch (e) {
                    console.error('Cart balance_pay fulfillment error:', e);
                }
            } else {
                // === 单商品订单：保持原有逻辑 ===
                const variant = await db.prepare('SELECT auto_delivery FROM variants WHERE id=?').bind(order.variant_id).first();
                if (variant && variant.auto_delivery === 1) {
                    let targetCardId = null;
                    try { const ph = JSON.parse(order.cards_sent); if (ph && ph.target_id) targetCardId = ph.target_id; } catch(e) {}
                    let cards;
                    if (targetCardId) {
                        cards = await db.prepare('UPDATE cards SET status=1, order_id=? WHERE id=? AND status=0 RETURNING id, content').bind(order_id, targetCardId).all();
                    } else {
                        cards = await db.prepare('UPDATE cards SET status=1, order_id=? WHERE id IN (SELECT id FROM cards WHERE variant_id=? AND status=0 LIMIT ?) RETURNING id, content').bind(order_id, order.variant_id, order.quantity).all();
                    }
                    if (cards.results.length >= order.quantity) {
                        cardsContent = cards.results.map(c => stripCardNote(c.content));
                        await db.prepare('UPDATE orders SET status=2, cards_sent=? WHERE id=?').bind(JSON.stringify(cardsContent), order_id).run();
                        await db.prepare('UPDATE variants SET sales_count = sales_count + ? WHERE id=?').bind(order.quantity, order.variant_id).run();
                        await db.prepare('UPDATE variants SET stock = (SELECT COUNT(*) FROM cards WHERE variant_id=? AND status=0) WHERE id=?').bind(order.variant_id, order.variant_id).run();
                    }
                }
            }
            return jsonRes({ success: true, balance: newBalance, cards: cardsContent });
        }

        // 会员订单列表
        // [订单查询限制] 会员中心仅显示/查询最近 90 天（约 3 个月）的订单
        if (path === '/api/member/orders' && method === 'GET') {
            const user = await memberAuth(request, env, db);
            if (!user) return errRes('请先登录', 401);
            const memberOrderCutoff = time() - MEMBER_ORDER_QUERY_DAYS * 86400;
            const { results } = await db.prepare('SELECT id, product_name, variant_name, price, quantity, total_amount, contact, payment_method, status, cards_sent, created_at, paid_at FROM orders WHERE user_id=? AND created_at>=? ORDER BY created_at DESC LIMIT 100').bind(user.id, memberOrderCutoff).all();
            return jsonRes(results);
        }

        // 会员余额变动记录
        // [订单查询限制] 会员中心仅显示/查询最近 90 天（约 3 个月）的交易记录
        if (path === '/api/member/transactions' && method === 'GET') {
            const user = await memberAuth(request, env, db);
            if (!user) return errRes('请先登录', 401);
            const memberTxCutoff = time() - MEMBER_ORDER_QUERY_DAYS * 86400;
            const { results } = await db.prepare('SELECT id, amount, type, description, order_id, created_at FROM balance_transactions WHERE user_id=? AND created_at>=? ORDER BY created_at DESC LIMIT 100').bind(user.id, memberTxCutoff).all();
            return jsonRes(results);
        }

        // 会员修改密码
        if (path === '/api/member/change_password' && method === 'POST') {
            const user = await memberAuth(request, env, db);
            if (!user) return errRes('请先登录', 401);
            const { old_password, new_password } = await request.json();
            if (!old_password || !new_password) return errRes('请填写原密码和新密码');
            if (new_password.length < 6) return errRes('新密码不能少于6位');
            if (new_password.length > 64) return errRes('新密码不能超过64位');
            if (old_password === new_password) return errRes('新密码不能与原密码相同');
            // 验证原密码
            const fullUser = await db.prepare('SELECT password_hash FROM users WHERE id=?').bind(user.id).first();
            if (!fullUser || !(await verifyPassword(old_password, fullUser.password_hash, env))) {
                return errRes('原密码错误');
            }
            // 更新密码 (自动使用新的 PBKDF2 哈希)
            const newHash = await hashPassword(new_password, env);
            const newEncrypted = await encryptPassword(new_password, env);
            await db.prepare('UPDATE users SET password_hash=?, password_encrypted=?, updated_at=? WHERE id=?').bind(newHash, newEncrypted, time(), user.id).run();
            return jsonRes({ success: true, message: '密码修改成功' });
        }

        // ===========================
        // --- 定时任务 API (Cron) ---
        // ===========================
        // [新增] Outlook Token 保活接口
        // 【安全修复】增加简单的 key 验证，防止被恶意扫描消耗资源
        // 复用 ADMIN_TOKEN 鉴权，访问：/api/cron/outlook?key=你的ADMIN_TOKEN
        if (path === '/api/cron/outlook' && url.searchParams.get('key') === env.ADMIN_TOKEN) {
            const logs = await refreshOutlookTokens(db);
            return jsonRes({ status: 'finished', logs });
        }

        // --- 订单与支付 API (Shop) ---   
        // [新增] 联系方式查单接口 (配合 orders.html)
        // [安全加固] 增加验证码校验 + 密码最低4位
        if (path === '/api/shop/orders/query' && method === 'POST') {
            const { contact, query_password, captchaText, captchaHash, captchaExpire } = await request.json();
            if (!contact || !query_password) return errRes('参数不完整');
            
            // [安全加固] 密码最低3位
            if (query_password.length < 3) {
                return errRes('查单密码不能少于3位');
            }

            // [安全加固] 校验图形验证码（服务端一次性令牌）
            if (!(await verifyCaptcha(db, captchaText, captchaHash, captchaExpire))) return errRes('图形验证码错误或已过期，请刷新重试', 400);

            // 查找匹配的订单
            // [订单查询限制] 前台仅可查询最近 30 天内创建的订单（游客与会员一致）
            const frontQueryCutoff = time() - FRONT_ORDER_QUERY_DAYS * 86400;
            // 1. 先尝试普通匹配 (联系方式 + 查单密码)
            let results = await db.prepare(`
                SELECT id, product_name, variant_name, total_amount, status, created_at, cards_sent 
                FROM orders 
                WHERE contact = ? AND query_password = ? AND created_at >= ?
                ORDER BY created_at DESC LIMIT 20
            `).bind(contact, query_password, frontQueryCutoff).all();

            // 2. 如果没找到，尝试会员密码匹配 (会员的 query_password 是加密存储的登录密码)
            if (!results.results || results.results.length === 0) {
                const memberUser = await db.prepare('SELECT id, password_hash FROM users WHERE email=?').bind(contact).first();
                if (memberUser) {
                    const passwordValid = await verifyPassword(query_password, memberUser.password_hash, env);
                    if (passwordValid) {
                        results = await db.prepare(`
                            SELECT id, product_name, variant_name, total_amount, status, created_at, cards_sent 
                            FROM orders 
                            WHERE contact = ? AND user_id = ? AND created_at >= ?
                            ORDER BY created_at DESC LIMIT 20
                        `).bind(contact, memberUser.id, frontQueryCutoff).all();
                    }
                }
            }
            
            // 格式化时间给前端
            const orders = results.results.map(o => {
                o.created_at_str = formatTime(o.created_at);
                return o;
            });

            return jsonRes(orders);
        }

        // =======================================================
        // [修改] 修复点 1： /api/shop/order/create
        // [修改] 增加未支付订单数量检查
        // =======================================================
        if (path === '/api/shop/order/create' && method === 'POST') {
            // 1. 接收参数
            const { variant_id, quantity, contact, payment_method, card_id, query_password } = await request.json();
            if (quantity <= 0 || !Number.isInteger(quantity)) return errRes('购买数量必须是大于0的整数', 400);

            // [优化] 提前检测会员身份，会员可跳过联系方式和查单密码
            let orderUserId = null;
            let isMember = false;
            let memberDiscount = 100;
            let memberEmail = '';
            let memberEncryptedPwd = '';
            try {
                const authHeader = request.headers.get('Authorization');
                if (authHeader && authHeader.startsWith('Bearer ')) {
                    const mUserId = await verifyToken(authHeader.substring(7), env);
                    if (mUserId) {
                        // 兼容旧数据库：表结构补齐（每实例仅一次）
                        await ensureMemberTables(db);
                        const mUser = await db.prepare('SELECT id, username, email, frozen, password_encrypted FROM users WHERE id=?').bind(mUserId).first();
                        if (mUser) {
                            if (mUser.frozen === 1) return errRes('账户已被冻结，无法下单，请联系客服', 403);
                            orderUserId = mUserId;
                            isMember = true;
                            memberEmail = mUser.email || mUser.username || '会员订单';
                            memberEncryptedPwd = mUser.password_encrypted || '';
                            // 获取会员折扣（统一口径：resolveMemberDiscount，与前台会员价展示一致）
                            const userRow = await db.prepare('SELECT member_level FROM users WHERE id=?').bind(mUserId).first();
                            memberDiscount = await resolveMemberDiscount(db, (userRow && userRow.member_level) ? userRow.member_level : 0);
                        }
                    }
                }
            } catch(e) {}

            // [优化] 会员强制使用邮箱+登录密码，完全忽略前端传值
            // 如果 password_encrypted 为空（旧用户），使用 user_id 作为标识
            const finalContact = isMember ? memberEmail : contact;
            const finalPassword = isMember ? (memberEncryptedPwd || ('uid_' + orderUserId)) : query_password;

            // 非会员必须验证联系方式和查单密码
            if (!isMember) {
                const contactRegex = /^[a-zA-Z0-9@._\-\u4e00-\u9fa5]+$/;
                if (!finalContact || !contactRegex.test(finalContact)) {
                    return errRes('联系方式格式不合法，仅允许输入邮箱、手机号、QQ、微信号或中文，严禁包含特殊符号', 400);
                }
                if (!finalPassword || finalPassword.length < 3) {
                    return errRes('请设置至少3位的查单密码');
                }
            }

            // --- 新增限制逻辑 START ---
            // 检查该联系人下的未支付订单数量
            const unpaidCount = (await db.prepare("SELECT COUNT(*) as c FROM orders WHERE contact=? AND status=0").bind(finalContact).first()).c;
            if (unpaidCount >= 2) {
                return errRes('您有过多未支付订单，请先支付或删除再下单', 400); 
            }
            // --- 新增限制逻辑 END ---

            const variant = await db.prepare("SELECT * FROM variants WHERE id=?").bind(variant_id).first();
            if (!variant) return errRes('规格不存在');
            if (variant.active === 0) return errRes('该规格已暂停销售');

            // === 库存检查 ===
            let stock = 0;
            if (variant.auto_delivery === 1) {
                // 自动发货：查卡密表
                stock = (await db.prepare("SELECT COUNT(*) as c FROM cards WHERE variant_id=? AND status=0").bind(variant_id).first()).c;
            } else {
                // 手动发货：查 variants 表的 stock 字段
                stock = variant.stock;
            }

            let finalQuantity = quantity;
            // 如果指定了 card_id (自选模式)，强制数量为 1
            if (card_id) {
                if (variant.auto_delivery !== 1) return errRes('手动发货商品不支持自选');
                finalQuantity = 1; 
                // 检查该卡密是否可用
                const targetCard = await db.prepare("SELECT id FROM cards WHERE id=? AND variant_id=? AND status=0").bind(card_id, variant_id).first();
                if (!targetCard) return errRes('该号码已被抢走或不存在，请重新选择');
            } else {
                if (stock < finalQuantity) return errRes('库存不足');
            }

            const product = await db.prepare("SELECT name, member_price_enabled FROM products WHERE id=?").bind(variant.product_id).first();
            const order_id = uuid();
            
            // === 价格计算 ===
            // [取低者] 会员折扣价 与 批发价 取较低者，不再叠加（不再“批发价再打折”）：
            //   basePrice = 参与会员折扣的基准价（自选模式含 custom_markup）
            //   listPrice = 未打折价（命中批发档位时为档位价，否则为基准价）
            let basePrice = variant.price;
            let listPrice = variant.price;
            
            if (card_id) {
                // 1. 自选模式：基础价 + 加价 (忽略批发价；自选不吃批发价，故维持“自选价 × 折扣”)
                if (variant.custom_markup > 0) { basePrice += variant.custom_markup; listPrice += variant.custom_markup; }
            } else {
                // 2. 随机模式：应用批发价
                if (variant.wholesale_config) {
                    try {
                        const wholesaleConfig = JSON.parse(variant.wholesale_config);
                        wholesaleConfig.sort((a, b) => b.qty - a.qty);
                        for (const rule of wholesaleConfig) {
                            if (finalQuantity >= rule.qty) {
                                listPrice = rule.price;
                                break;
                            }
                        }
                    } catch(e) {}
                }
            }
            
            // 如果指定了卡密，暂存在 cards_sent 字段中
            let cardsSentPlaceholder = null;
            if (card_id) cardsSentPlaceholder = JSON.stringify({ target_id: card_id });

            // 记录未打折价，再与会员折扣价“取低者”（商品未开启“会员价”时不享受折扣）
            const originalPrice = listPrice;
            const memberPriceOn = !product || product.member_price_enabled !== 0;
            let finalPrice;
            if (memberDiscount < 100 && memberPriceOn) {
                // [取低者] 会员折扣价 = basePrice × 折扣；与 批发/自选价 listPrice 取低，不叠加
                finalPrice = Math.round(Math.min(listPrice, basePrice * memberDiscount / 100) * 100) / 100;
            } else {
                finalPrice = listPrice;
            }

            const total_amount = (finalPrice * finalQuantity).toFixed(2);
            if (total_amount <= 0) return errRes('金额必须大于 0');

            await db.prepare("INSERT INTO orders (id, variant_id, product_name, variant_name, price, quantity, total_amount, contact, query_password, payment_method, created_at, status, cards_sent, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)")
                .bind(order_id, variant_id, product.name, variant.name, finalPrice, finalQuantity, total_amount, finalContact, finalPassword, payment_method, time(), cardsSentPlaceholder, orderUserId).run();

            // 返回会员折扣信息给前端
            const discountInfo = (memberDiscount < 100 && memberPriceOn) ? { member_discount: memberDiscount, original_price: parseFloat((originalPrice * finalQuantity).toFixed(2)) } : null;
            return jsonRes({ order_id, total_amount, payment_method, discount: discountInfo });
        }

        // =======================================================
        // [修改] 修复点 2： /api/shop/cart/checkout
        // [修改] 增加未支付订单数量检查
        // =======================================================
        if (path === '/api/shop/cart/checkout' && method === 'POST') {
            const { items, contact, query_password, payment_method } = await request.json();
            
            if (!items || items.length === 0) return errRes('购物车为空');
            if (items.length > 30) return errRes('购物车商品种类过多，请分批下单', 400);

            // [优化] 提前检测会员身份，会员可跳过联系方式和查单密码
            let cartUserId = null;
            let isMember = false;
            let memberDiscount = 100;
            let memberEmail = '';
            let memberEncryptedPwd = '';
            try {
                const authHeader = request.headers.get('Authorization');
                if (authHeader && authHeader.startsWith('Bearer ')) {
                    const mUserId = await verifyToken(authHeader.substring(7), env);
                    if (mUserId) {
                        // 兼容旧数据库：表结构补齐（每实例仅一次）
                        await ensureMemberTables(db);
                        const mUser = await db.prepare('SELECT id, username, email, frozen, password_encrypted FROM users WHERE id=?').bind(mUserId).first();
                        if (mUser) {
                            if (mUser.frozen === 1) return errRes('账户已被冻结，无法下单，请联系客服', 403);
                            cartUserId = mUserId;
                            isMember = true;
                            memberEmail = mUser.email || mUser.username || '会员订单';
                            memberEncryptedPwd = mUser.password_encrypted || '';
                            // 获取会员折扣（统一口径：resolveMemberDiscount，与前台会员价展示一致）
                            const userRow2 = await db.prepare('SELECT member_level FROM users WHERE id=?').bind(mUserId).first();
                            memberDiscount = await resolveMemberDiscount(db, (userRow2 && userRow2.member_level) ? userRow2.member_level : 0);
                        }
                    }
                }
            } catch(e) {}

            // [优化] 会员强制使用邮箱+登录密码，完全忽略前端传值
            // 如果 password_encrypted 为空（旧用户），使用 user_id 作为标识
            const finalContact = isMember ? memberEmail : contact;
            const finalPassword = isMember ? (memberEncryptedPwd || ('uid_' + cartUserId)) : query_password;

            // 非会员必须验证
            if (!isMember) {
                const contactRegex = /^[a-zA-Z0-9@._\-\u4e00-\u9fa5]+$/;
                if (!finalContact || !contactRegex.test(finalContact)) {
                    return errRes('联系方式格式不合法，仅允许输入邮箱、手机号、QQ、微信号或中文，严禁包含特殊符号', 400);
                }
                if (!finalPassword || finalPassword.length < 3) {
                    return errRes('请设置至少3位的查单密码');
                }
            }

            // --- 新增限制逻辑 START ---
            const unpaidCount = (await db.prepare("SELECT COUNT(*) as c FROM orders WHERE contact=? AND status=0").bind(finalContact).first()).c;
            if (unpaidCount >= 2) {
                return errRes('您有过多未支付订单，请先支付或删除再下单', 400);
            }
            // --- 新增限制逻辑 END ---

            let total_amount = 0;
            const validatedItems = []; // 存储后端验证过的商品信息

            for (const item of items) {
                if (item.quantity <= 0 || !Number.isInteger(item.quantity)) return errRes('商品数量非法', 400);
                // 假设前端传来的 ID 正确，查库验证
                // 注意：前端 cart-page.js 已修复为传 variantId
                const variant = await db.prepare("SELECT * FROM variants WHERE id=?").bind(item.variantId).first();
                if (!variant) throw new Error('商品规格不存在');
                const product = await db.prepare("SELECT name, member_price_enabled FROM products WHERE id=?").bind(variant.product_id).first();

                let stock = 0;
                // [取低者] basePrice = 参与会员折扣的基准价；listPrice = 未打折价（批发档位价或基准价）
                let basePrice = variant.price;
                let listPrice = variant.price; // 从数据库重新计算

                if (item.buyMode === 'select' && item.selectedCardId) {
                    // 1. 自选模式
                    if (variant.auto_delivery !== 1) throw new Error('手动发货商品不支持自选');
                    const targetCard = await db.prepare("SELECT id FROM cards WHERE id=? AND variant_id=? AND status=0")
                        .bind(item.selectedCardId, item.variantId).first();
                    if (!targetCard) throw new Error(`商品 ${item.variantName} 的自选号码已被抢走`);
                    stock = 1; // 足够
                    
                    // 重新计算自选价格（自选不吃批发价，故维持“自选价 × 折扣”）
                    basePrice = variant.price;
                    listPrice = variant.price;
                    if (variant.custom_markup > 0) { basePrice += variant.custom_markup; listPrice += variant.custom_markup; }
                    
                } else {
                    // 2. 随机/手动 模式
                    if (variant.auto_delivery === 1) {
                        stock = (await db.prepare("SELECT COUNT(*) as c FROM cards WHERE variant_id=? AND status=0").bind(item.variantId).first()).c;
                    } else {
                        stock = variant.stock;
                    }
                    if (stock < item.quantity) throw new Error(`商品 ${item.variantName} 库存不足 (仅剩 ${stock} 件)`);
                    
                    // 2b. 重新计算批发价 (仅随机模式) —— 只改 listPrice，basePrice 保持原价供会员折扣比较
                    listPrice = variant.price;
                    if (variant.wholesale_config) {
                        try {
                            const wholesaleConfig = JSON.parse(variant.wholesale_config);
                            wholesaleConfig.sort((a, b) => b.qty - a.qty);
                            for (const rule of wholesaleConfig) {
                                if (item.quantity >= rule.qty) {
                                    listPrice = rule.price;
                                    break;
                                }
                            }
                        } catch(e) {}
                    }
                }
                
                total_amount += (listPrice * item.quantity);
                
                // 存储验证后的信息
                validatedItems.push({
                    variantId: variant.id,
                    productName: product ? product.name : '未知商品',
                    variantName: variant.name,
                    quantity: item.quantity,
                    price: listPrice, // 使用后端计算的单价（未打折价）
                    memberBase: basePrice, // 参与会员折扣的基准价（仅用于取低者比较，不入库）
                    buyMode: item.buyMode,
                    selectedCardId: item.selectedCardId,
                    auto_delivery: variant.auto_delivery, // 存储发货类型
                    memberPriceEnabled: !product || product.member_price_enabled !== 0 // 商品级会员价开关（仅用于折扣计算，不入库）
                });
            }

            // 获取会员 user_id 并应用会员折扣
            // (已在上方提前检测)

            // 应用会员折扣（未开启“会员价”的商品不享受折扣）
            // [取低者] 会员折扣价 = memberBase × 折扣；与 未打折价 vi.price 取低，不叠加
            let anyDiscounted = false;
            let originalTotal = 0;
            if (memberDiscount < 100) {
                for (const vi of validatedItems) {
                    originalTotal += vi.price * vi.quantity;
                    if (vi.memberPriceEnabled) {
                        vi.price = Math.round(Math.min(vi.price, vi.memberBase * memberDiscount / 100) * 100) / 100;
                        anyDiscounted = true;
                    }
                    delete vi.memberPriceEnabled;
                    delete vi.memberBase; // 不随 cards_sent 入库
                }
                total_amount = validatedItems.reduce((sum, vi) => sum + vi.price * vi.quantity, 0);
            } else {
                for (const vi of validatedItems) {
                    originalTotal += vi.price * vi.quantity;
                    delete vi.memberPriceEnabled;
                    delete vi.memberBase; // 不随 cards_sent 入库
                }
            }

            if (total_amount <= 0.01) return errRes('金额必须大于 0.01');

            const order_id = uuid();
            const now = time();

            // 创建一个“父订单”
            await db.prepare(`
                INSERT INTO orders (id, variant_id, product_name, variant_name, price, quantity, total_amount, contact, query_password, payment_method, created_at, status, cards_sent, user_id) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
            `).bind(
                order_id, 
                0, // 0 表示这是一个合并订单
                "购物车合并订单",
                `共 ${items.length} 件商品`,
                total_amount, 
                1, 
                total_amount.toFixed(2),
                finalContact,
                finalPassword,
                payment_method,
                now,
                JSON.stringify(validatedItems), // 将验证过的购物车存入 cards_sent
                cartUserId
            ).run();

            // 返回会员折扣信息（与单买接口同结构，前端据此提示“会员折扣已生效”）
            const cartDiscountInfo = anyDiscounted ? { member_discount: memberDiscount, original_price: parseFloat(originalTotal.toFixed(2)) } : null;
            return jsonRes({ order_id, total_amount, payment_method, discount: cartDiscountInfo });
        }

        // =======================================================
        // [新增] 用户删除未支付订单接口 (配合 orders.html)
        // =======================================================
        if (path === '/api/shop/order/delete' && method === 'POST') {
            const { id, contact, query_password } = await request.json();
            
            // 1. 验证订单归属 (必须匹配 ID, Contact, Password, 且 Status=0)
            const order = await db.prepare("SELECT id FROM orders WHERE id=? AND contact=? AND query_password=? AND status=0")
                .bind(id, contact, query_password).first();
                
            if (!order) {
                return errRes('删除失败：订单不存在、密码错误或订单已支付');
            }

            // 2. 执行删除
            await db.prepare("DELETE FROM orders WHERE id=?").bind(id).run();
            await db.prepare("DELETE FROM site_config WHERE key=?").bind('qr_' + id).run();
            return jsonRes({ success: true });
        }


        if (path === '/api/shop/pay' && method === 'POST') {
             const { order_id } = await request.json();
             const order = await db.prepare("SELECT * FROM orders WHERE id=?").bind(order_id).first();
             if (!order) return errRes('订单不存在');
             if (order.status >= 1) return jsonRes({ paid: true });

             // ===== 新增: 根据前台传来的 ID 获取对应的独立支付配置 =====
             let gateway = await db.prepare("SELECT type, name, config FROM pay_gateways WHERE id=? AND active=1").bind(order.payment_method).first();
             if(!gateway) {
                 gateway = await db.prepare("SELECT type, name, config FROM pay_gateways WHERE type=? AND active=1").bind(order.payment_method).first();
             }
             if(!gateway) return errRes('该支付方式未配置或已停用');
             const config = JSON.parse(gateway.config);

            // 读取订单标题前缀配置
            const orderPrefixRow = await db.prepare("SELECT value FROM site_config WHERE key='order_prefix'").first();
            const orderPrefix = orderPrefixRow?.value || '';

             if (gateway.type === 'alipay_f2f') {
             // [新增代码 START] 检查是否有缓存的二维码，有则直接返回，不再请求支付宝
             const cachedQr = await db.prepare("SELECT value FROM site_config WHERE key=?").bind('qr_' + order.id).first();
             if (cachedQr && cachedQr.value) {
                 return jsonRes({ type: 'qrcode', gateway_type: gateway.type, gateway_name: gateway.name, gateway_icon: config.icon || '', qr_code: cachedQr.value, order_id: order.id, amount: order.total_amount });
             }
             // [新增代码 END]
                 if (!config.app_id || !config.private_key || !config.alipay_public_key) {
                     return errRes('支付配置不完整');
                 }

                 const params = {
                     app_id: config.app_id,
                     method: 'alipay.trade.precreate',
                     format: 'JSON', charset: 'utf-8', sign_type: 'RSA2', version: '1.0',
                     timestamp: new Date().toISOString().replace('T', ' ').split('.')[0],
                     notify_url: `${url.origin}/api/notify/alipay`,
                     biz_content: JSON.stringify({
                         out_trade_no: order.id,
                         total_amount: order.total_amount,
                        subject: orderPrefix
                            ? (order.variant_id === 0 ? `${orderPrefix}购物车合并订单` : `${orderPrefix}订单号：${order.id}`)
                            : (order.variant_id === 0 ? '购物车合并订单' : `订单号：${order.id}`)
                     })
                 };
                 params.sign = await signAlipay(params, config.private_key);
                 
                 const query = Object.keys(params).map(k => `${k}=${encodeURIComponent(params[k])}`).join('&');
                 const aliRes = await fetch(`https://openapi.alipay.com/gateway.do?${query}`);
                 const aliData = await aliRes.json();

                 if (aliData.alipay_trade_precreate_response?.code === '10000') {
                     // [新增代码 START] 将获取到的二维码链接存入数据库
                     const qrUrl = aliData.alipay_trade_precreate_response.qr_code;
                     await db.prepare("INSERT INTO site_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind('qr_' + order.id, qrUrl).run();
                     // [新增代码 END]

                     return jsonRes({
                         type: 'qrcode',
                         gateway_type: gateway.type,
                         gateway_name: gateway.name,
                         gateway_icon: config.icon || '',
                         qr_code: qrUrl,
                         order_id: order.id,
                         amount: order.total_amount
                     });
                 } else {
                     return errRes('支付宝错误: ' + (aliData.alipay_trade_precreate_response?.sub_msg || JSON.stringify(aliData)));
                 }
             }
             if (gateway.type.startsWith('usdt_')) {
                 if (!config.wallet_address) return errRes('后台未配置该网络收款地址');

                 // 汇率转换与并发防串单逻辑
                 const rate = parseFloat(config.exchange_rate) || 1;
                 const baseUsdt = parseFloat(order.total_amount) / rate;
                 
                 // 生成 0.0001 ~ 0.0099 的随机尾数，防止多人同时下单同一金额发生冲突
                 const randomOffset = Math.floor(Math.random() * 39 + 1) / 100;
                 const finalUsdtAmount = (baseUsdt + randomOffset).toFixed(2); 
                 
                 // 关键点：将这个精确的 4 位小数 U 金额存入 trade_no，用于等一下回调时的精确匹配
                 await db.prepare("UPDATE orders SET trade_no=? WHERE id=?").bind(finalUsdtAmount, order.id).run();
                 // ====== 【核心新增：下发按需监控指令给 xy-usk】 ======
                 try {
                     // 优先使用该网关配置中的 usk_api_url，确保多商户独立性
                     if (config.usk_api_url && config.app_secret) {
						 const netName = gateway.type.replace('usdt_', '').toUpperCase().replace(/[^A-Z0-9]/g, '');
                         // 异步下发请求，不阻塞用户看到支付界面的速度
                         fetch(config.usk_api_url, {
                             method: 'POST',
                             headers: {
                                 'Content-Type': 'application/json',
                                 'Authorization': `Bearer ${config.app_secret}` // 使用后台填写的 Secret 进行双向鉴权
                             },
                             body: JSON.stringify({
                                 address: config.wallet_address,
                                 network: netName,
                                 amount: finalUsdtAmount,
                                 order_id: order.id
                             })
                         }).catch(e => console.error("通知监控系统失败:", e));
                     }
                 } catch (e) { console.error("异步触发监控节点异常", e); }
                 // ====== 【指令下发结束】 ======

                 return jsonRes({
                     type: gateway.type,
                     gateway_type: gateway.type,
                     gateway_name: gateway.name,
                     gateway_icon: config.icon || '',
                     wallet_address: config.wallet_address,
                     order_id: order.id,
                     amount: finalUsdtAmount
                 });
             }
             // ====== 易支付 (EasyPay) —— 与 dujiao-next 同款协议 (v1 MD5 / v2 RSA) ======
             if (gateway.type === 'yipay') {
                 const isV2 = String(config.epay_version || '').toLowerCase().trim() === 'v2';
                 // 配置校验 (与 dujiao-next ValidateConfig 一致)
                 if (!config.gateway_url || !config.merchant_id) return errRes('易支付配置不完整：缺少网关地址或商户ID');
                 if (isV2) {
                     if (!config.private_key || !config.platform_public_key) return errRes('易支付 v2 配置不完整：需要商户私钥和平台公钥');
                 } else if (!config.merchant_key) {
                     return errRes('易支付 v1 配置不完整：缺少商户密钥');
                 }
                 const payType = resolveEpayPayType(config.channel_type || config.pay_type || 'alipay');
                 if (!payType) return errRes('易支付不支持的支付方式');

                 // notify_url / return_url：优先用配置值，为空则自动生成（与 dujiao-next fallback 逻辑一致）
                 const epayNotifyUrl = String(config.notify_url || '').trim() || `${url.origin}/api/notify/yipay`;
                 const epayReturnUrl = String(config.return_url || '').trim() || `${url.origin}/pay?order_id=${order.id}`;
                 const epayName = orderPrefix ? `${orderPrefix}${order.product_name || '商品订单'}` : (order.product_name || '商品订单');
                 const baseParams = {
                     pid: config.merchant_id,
                     type: payType,
                     out_trade_no: order.id,
                     notify_url: epayNotifyUrl,
                     return_url: epayReturnUrl,
                     name: epayName,
                     money: Number(order.total_amount).toFixed(2)
                 };
                 const gatewayBase = config.gateway_url.replace(/\/+$/, '');
                 // 交互模式：redirect=页面跳转（默认，兼容旧配置）；qr/api=服务端下单接口
                 const mode = String(config.interaction_mode || '').toLowerCase().trim();
                 const buildQuery = (p) => Object.keys(p).filter(k => String(p[k]) !== '').map(k => `${k}=${encodeURIComponent(p[k])}`).join('&');

                 // ===== 模式一：页面跳转 (与 dujiao-next BuildRedirectURL 一致) =====
                 if (mode === 'redirect') {
                     const params = { ...baseParams };
                     let submitPath = '/submit.php';
                     if (isV2) {
                         params.timestamp = String(time());
                         params.sign = await epaySignRSA(epaySignContent(params), config.private_key);
                         params.sign_type = 'RSA';
                         submitPath = '/api/pay/submit';
                     } else {
                         params.sign = await epaySignMD5(epaySignContent(params), config.merchant_key);
                         params.sign_type = 'MD5';
                     }
                     return jsonRes({
                         type: 'redirect',
                         gateway_type: gateway.type,
                         gateway_name: gateway.name,
                         gateway_icon: config.icon || '',
                         pay_url: `${gatewayBase}${submitPath}?${buildQuery(params)}`,
                         order_id: order.id,
                         amount: order.total_amount
                     });
                 }

                 // ===== 模式二：API 接口下单 (与 dujiao-next CreatePayment 一致) =====
                 const params = { ...baseParams, clientip: getClientIP(request) };
                 let endpoint = '';
                 if (isV2) {
                     params.method = String(config.method || 'web').trim();
                     params.timestamp = String(time());
                     params.sign = await epaySignRSA(epaySignContent(params), config.private_key);
                     params.sign_type = 'RSA';
                     endpoint = gatewayBase + (String(config.api_path || '').trim() || '/api/pay/create');
                 } else {
                     params.device = String(config.device || 'pc').trim();
                     params.sign = await epaySignMD5(epaySignContent(params), config.merchant_key);
                     params.sign_type = 'MD5';
                     endpoint = gatewayBase + (String(config.api_path || '').trim() || '/mapi.php');
                 }
                 let epayResp;
                 try {
                     const formBody = new URLSearchParams();
                     Object.keys(params).forEach(k => { if (String(params[k]) !== '') formBody.append(k, params[k]); });
                     const rawRes = await fetch(endpoint, {
                         method: 'POST',
                         headers: {
                             'Content-Type': 'application/x-www-form-urlencoded',
                             'Accept': 'application/json, text/plain, */*',
                             // 与 dujiao-next 一致的浏览器 UA，避免部分网关 WAF 拦截非浏览器请求
                             'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                         },
                         body: formBody,
                         // 与 dujiao-next 一致的 10 秒超时（Cloudflare Workers 用 AbortSignal 实现）
                         signal: AbortSignal.timeout(10000)
                     });
                     if (!rawRes.ok) return errRes('易支付请求失败: HTTP ' + rawRes.status);
                     let rawText = (await rawRes.text()).trim();
                     // 兼容部分网关返回双重编码 JSON（与 dujiao-next normalizeResponseBody 一致）
                     if (rawText.startsWith('"')) {
                         try { rawText = JSON.parse(rawText); } catch(e) {}
                     }
                     epayResp = JSON.parse(rawText);
                 } catch (e) {
                     return errRes('易支付响应解析失败: ' + e.message);
                 }
                 // v1 成功码 code=1，v2 成功码 code=0（与 dujiao-next 一致）
                 const okCode = isV2 ? 0 : 1;
                 if (Number(epayResp.code) !== okCode) return errRes('易支付错误: ' + (epayResp.msg || epayResp.message || JSON.stringify(epayResp)));

                 const commonResp = { gateway_type: gateway.type, gateway_name: gateway.name, gateway_icon: config.icon || '', order_id: order.id, amount: order.total_amount };
                 if (isV2) {
                     const payInfo = String(epayResp.pay_info || '').trim();
                     if (!payInfo) return errRes('易支付返回数据异常：未包含支付信息');
                     if (String(epayResp.pay_type || '').toLowerCase() === 'qrcode') return jsonRes({ type: 'qrcode', qr_code: payInfo, ...commonResp });
                     return jsonRes({ type: 'redirect', pay_url: payInfo, ...commonResp });
                 }
                 const qrCode = String(epayResp.qrcode || '').trim();
                 const payUrl = String(epayResp.payurl || epayResp.urlscheme || '').trim();
                 if (qrCode) return jsonRes({ type: 'qrcode', qr_code: qrCode, ...commonResp });
                 if (payUrl) return jsonRes({ type: 'redirect', pay_url: payUrl, ...commonResp });
                 return errRes('易支付返回数据异常：未包含支付链接');
             }
             return errRes('未知的支付方式');
        }

        if (path === '/api/shop/order/status') {
            const order_id = url.searchParams.get('order_id');
            // [订单查询限制] 前台页面查询时传 window_days=30，超过窗口的订单直接拒绝；
            // 收银台轮询不传该参数，不受影响（新订单本来就在窗口内）
            const windowDays = parseInt(url.searchParams.get('window_days') || '0', 10);
            const order = await db.prepare("SELECT status, cards_sent, created_at FROM orders WHERE id=?").bind(order_id).first();
            if (windowDays > 0 && order && order.created_at && (time() - order.created_at) > windowDays * 86400) {
                return errRes(`仅支持查询最近 ${windowDays} 天内的订单，更早的订单请联系客服处理`, 403);
            }
            if(order && order.status >= 1) {
                return jsonRes({ status: order.status, cards: JSON.parse(order.cards_sent || '[]') });
            }
            return jsonRes({ status: 0 });
        }

        // ===========================
        // --- 支付回调 (Notify) ---
        // ===========================
        if (path === '/api/notify/alipay' && method === 'POST') {
            const formData = await request.formData();
            const params = {};
            for (const [key, value] of formData.entries()) {
                params[key] = value;
            }
            
            // 获取所有启用的支付宝配置，并根据回调传回的 app_id 寻找对应的那个支付宝账号
            const gateways = await db.prepare("SELECT config FROM pay_gateways WHERE type='alipay_f2f' AND active=1").all();
            let config = null;
            for (const g of gateways.results) {
                const c = JSON.parse(g.config);
                if (c.app_id === params.app_id) { config = c; break; }
            }
            if (!config) { console.error('Alipay Notify: Gateway not found for this AppID'); return new Response('fail'); }

            const signVerified = await verifyAlipaySignature(params, config.alipay_public_key);
            
            // 验签失败直接返回
            if (!signVerified) {
                console.error('Alipay Notify: Signature verification failed');
                return new Response('fail');
            }

            if (params.trade_status === 'TRADE_SUCCESS') {
                const out_trade_no = params.out_trade_no;
                const trade_no = params.trade_no;
                // 【安全修复】新增支付金额与应用ID的严格校验防篡改
                const checkOrder = await db.prepare("SELECT * FROM orders WHERE id=? AND status=0").bind(out_trade_no).first();
                if (!checkOrder) return new Response('fail');
                if (parseFloat(params.total_amount) !== parseFloat(checkOrder.total_amount) || params.app_id !== config.app_id) {
                    console.error('Alipay Notify: Amount or AppId mismatch');
                    return new Response('fail');
                }
                const updateRes = await db.prepare("UPDATE orders SET status=1, paid_at=?, trade_no=? WHERE id=? AND status=0")
                        .bind(time(), trade_no, out_trade_no).run();
                if (!updateRes.success || updateRes.meta.changes !== 1) {
                    return new Response('success'); 
                }
                try {
                    await db.prepare("DELETE FROM site_config WHERE key=?").bind('qr_' + out_trade_no).run();
                } catch(e) { console.error('Clear QR cache error:', e); }
                const order = await db.prepare("SELECT * FROM orders WHERE id=? AND status=1").bind(out_trade_no).first();
                
                // === 充值订单处理 ===
                if (order && order.product_name === '会员充值' && order.user_id) {
                    const rechargeAmount = order.total_amount;
                    const currentBalance = (await db.prepare('SELECT balance FROM users WHERE id=?').bind(order.user_id).first()).balance || 0;
                    await db.prepare('UPDATE users SET balance=?, updated_at=? WHERE id=?').bind(currentBalance + rechargeAmount, time(), order.user_id).run();
                    await db.prepare('UPDATE users SET total_recharge = total_recharge + ?, total_incoming = total_incoming + ? WHERE id=?').bind(rechargeAmount, rechargeAmount, order.user_id).run();
                    await db.prepare('INSERT INTO balance_transactions (user_id, amount, type, description, order_id, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(order.user_id, rechargeAmount, 'recharge', '充值' + rechargeAmount + '元', out_trade_no, time()).run();
                    // [v1] 自动升级统一入口：口径 total_incoming；管理员手动设定（level_source='manual'）优先级最高
                    await applyAutoUpgrade(db, order.user_id);
                    return new Response('success');
                }
                
                if (order) {
                    
                    // --- 1. 读取配置 (新增客户通知配置) ---
                    const adminConfigKeys = [
                        'tg_active', 'tg_bot_token', 'tg_chat_id', 
                        'mail_to', 'site_name',
                        'outlook_active', 'outlook_client_id', 'outlook_client_secret', 'outlook_refresh_token'
                    ];
                    // [新增] 客户通知的配置键
                    const customerConfigKeys = [
                        'customer_outlook_active', 'customer_outlook_client_id', 
                        'customer_outlook_client_secret', 'customer_outlook_refresh_token'
                    ];
                    const allConfigKeys = [...adminConfigKeys, ...customerConfigKeys];
                    const placeholders = allConfigKeys.map(() => '?').join(',');
                    
                    const systemConfig = {};
                    try {
                        const confRes = await db.prepare(`SELECT key, value FROM site_config WHERE key IN (${placeholders})`).bind(...allConfigKeys).all();
                        if (confRes && confRes.results) {
                            confRes.results.forEach(r => systemConfig[r.key] = r.value);
                        }
                    } catch(e) { console.error("Config read error:", e); }

                    // --- 2. 初始化发货数据结构 ---
                    let contentBody = ''; // for Admin notification
                    const allCardsContent = []; // Delivered cards (for order update and customer email)
                    const stmts = []; // DB statements for fulfillment
                    const autoVariantIdsToUpdate = new Set(); // Auto-delivery variants needing stock update
                    let newOrderStatus = 2; // Assume success/manual for now
                    const isCartOrder = order.variant_id === 0;
                    let singleVariant; // Store variant info for single order mode (only used if not cart order)


                    // --- 3. 核心发货逻辑 (填充 stmts, allCardsContent, contentBody) ---
                    try {
                        
                        if (isCartOrder) {
                            // === 情况A：购物车合并订单 ===
                            contentBody = '【购物车合并订单】\n----------------';
                            const cartItems = JSON.parse(order.cards_sent || '[]');
                            
                            for (const item of cartItems) {
                                let itemCardsContent = [];
                                const variant = await db.prepare("SELECT auto_delivery, stock, random_mode_text FROM variants WHERE id=?").bind(item.variantId).first();
                                
                                if (!variant) continue; // Skip if variant no longer exists

                                if (variant.auto_delivery === 1) {
                                    // 自动发货
                                    let cards;
                                    if (item.buyMode === 'select' && item.selectedCardId) {
                                        cards = await db.prepare("UPDATE cards SET status=1, order_id=? WHERE id=? AND status=0 RETURNING id, content").bind(out_trade_no, item.selectedCardId).all();
                                    } else {
                                        cards = await db.prepare("UPDATE cards SET status=1, order_id=? WHERE id IN (SELECT id FROM cards WHERE variant_id=? AND status=0 LIMIT ?) RETURNING id, content").bind(out_trade_no, item.variantId, item.quantity).all();
                                    }
                                    
                                    if (cards.results.length >= item.quantity) {
                                        // 优化：在购物车的卡密前加上具体商品名称，让客户一目了然
                                        itemCardsContent = cards.results.map(c => `【${item.productName} - ${item.variantName}】\n${stripCardNote(c.content)}`);
                                        allCardsContent.push(...itemCardsContent);
                                        
                                        stmts.push(db.prepare("UPDATE variants SET sales_count = sales_count + ? WHERE id=?").bind(item.quantity, item.variantId));
                                        autoVariantIdsToUpdate.add(item.variantId);

                                        // Admin 通知内容补充
                                        let itemNote = ` (${variant.random_mode_text || '随机'})`;
                                        if (item.buyMode === 'select' && item.selectedCardId) {
                                            const card = await db.prepare("SELECT content FROM cards WHERE id=?").bind(item.selectedCardId).first();
                                            const match = card?.content.match(/#\[(.*?)\]/);
                                            itemNote = ` (自选: ${match ? match[1] : '指定卡密'})`;
                                        }
                                        // 库存显示
                                        const currentCardCount = (await db.prepare("SELECT COUNT(*) as c FROM cards WHERE variant_id=? AND status=0").bind(item.variantId).first()).c;
                                        const finalStock = currentCardCount;
                                        contentBody += `\n• ${item.productName} - ${item.variantName}${itemNote} × ${item.quantity} (库存：${finalStock})`;
                                    } else {
                                        // 缺货，不发货，但订单状态保持已支付 (status=1)
                                        contentBody += `\n• ${item.productName} - ${item.variantName} × ${item.quantity} (缺货，需手动处理)`;
                                        newOrderStatus = 1; 
                                    }
                                } else {
                                    // 手动发货
                                    const cartUpdateRes = await db.prepare("UPDATE variants SET stock = stock - ?, sales_count = sales_count + ? WHERE id=? AND stock >= ?").bind(item.quantity, item.quantity, item.variantId, item.quantity).run();
                                    if(cartUpdateRes.meta.changes === 0) {
                                        contentBody += `\n• ${item.productName} - ${item.variantName} (并发售罄，需手动处理) × ${item.quantity}`;
                                        allCardsContent.push(`【${item.productName} - ${item.variantName}】\n该商品为手动发货，系统已接单，请联系客服为您处理。`);
                                        newOrderStatus = 1;
                                        continue;
                                    }
                                    const finalStock = Math.max(0, (variant.stock || 0) - item.quantity);
                                    contentBody += `\n• ${item.productName} - ${item.variantName} (手动发货) × ${item.quantity} (库存：${finalStock})`;
                                    allCardsContent.push(`【${item.productName} - ${item.variantName}】\n该商品为手动发货，已通知客服为您排单处理。`);
                                    newOrderStatus = 1; 
                                }
                            }
                            if (newOrderStatus !== 1 && allCardsContent.length === 0) {
                                // 纯手动发货的购物车订单，确保状态仍为 2
                                newOrderStatus = 2;
                            }
                        } else {
                            // === 情况B：单个商品直接下单 ===
                            singleVariant = await db.prepare("SELECT auto_delivery, name, price, stock, random_mode_text FROM variants WHERE id=?").bind(order.variant_id).first();
                            if (!singleVariant) throw new Error("Variant not found for single order fulfillment.");
                            
                            let modeLine = `类型：${singleVariant.random_mode_text || '默认随机'}`;
                            
                            if (singleVariant.auto_delivery === 1) {
                                // 自动发货
                                let targetCardId = null;
                                try {
                                    const placeholder = JSON.parse(order.cards_sent);
                                    if (placeholder && placeholder.target_id) targetCardId = placeholder.target_id;
                                } catch(e) {}
                                let cards;
                                if (targetCardId) {
                                    cards = await db.prepare("UPDATE cards SET status=1, order_id=? WHERE id=? AND status=0 RETURNING id, content").bind(out_trade_no, targetCardId).all();
                                } else {
                                    cards = await db.prepare("UPDATE cards SET status=1, order_id=? WHERE id IN (SELECT id FROM cards WHERE variant_id=? AND status=0 LIMIT ?) RETURNING id, content").bind(out_trade_no, order.variant_id, order.quantity).all();
                                }
                            
                                if (cards.results.length >= order.quantity) {
                                    allCardsContent.push(...cards.results.map(c => stripCardNote(c.content)));
                                    
                                    stmts.push(db.prepare("UPDATE variants SET sales_count = sales_count + ? WHERE id=?").bind(order.quantity, order.variant_id));
                                    autoVariantIdsToUpdate.add(order.variant_id);
                                    
                                    if (targetCardId) {
                                        const match = cards.results[0]?.content.match(/#\[(.*?)\]/);
                                        modeLine = `类型：自选/加价 (${match ? match[1] : '指定卡密'})`;
                                    }
                                } else {
                                    console.error(`Notify Warning: Order ${out_trade_no} paid but insufficient stock.`);
                                    newOrderStatus = 1; // 缺货，保持已支付状态
                                }
                            } else {
                                // 手动发货
                                const stockUpdateRes = await db.prepare("UPDATE variants SET stock = stock - ?, sales_count = sales_count + ? WHERE id=? AND stock >= ?").bind(order.quantity, order.quantity, order.variant_id, order.quantity).run();
                                if(stockUpdateRes.meta.changes === 0) {
                                    throw new Error("手动发货库存不足，并发扣除失败");
                                }
                                modeLine = '类型：手动发货';
                                
                                // 【新增】把手动发货的提示作为“虚拟卡密”塞进去
                                allCardsContent.push(`【${order.product_name} - ${order.variant_name}】\n该商品为手动发货，已通知客服为您排单处理。`);
                                
                                newOrderStatus = 1; // 标记状态为待发货
                            }

                            // Admin 通知内容
                            const currentCardCount = (await db.prepare("SELECT COUNT(*) as c FROM cards WHERE variant_id=? AND status=0").bind(order.variant_id).first()).c;
                            // 自动发货查出的已是最终库存，手动发货则需减去当前购买量
                            const finalStock = singleVariant.auto_delivery === 1 ? currentCardCount : Math.max(0, singleVariant.stock - order.quantity);
                            
                            contentBody = `商品：${order.product_name}\n规格：${order.variant_name}\n${modeLine}\n数量：${order.quantity} (库存：${finalStock})`;
                        }

                    } catch (e) {
                        console.error('Fulfillment Error:', e);
                        newOrderStatus = 1; // 出现错误，状态保持已支付，留待人工处理
                        contentBody += '\n(发货系统错误，请人工核查!)';
                    }

                    // --- 4. 数据库最终更新 (订单状态和卡密内容) ---
                    if (newOrderStatus === 2) {
                        // 完全成功（全自动发货或纯手动发货），更新状态为已完成 2
                        stmts.push(db.prepare("UPDATE orders SET status=2, cards_sent=? WHERE id=?").bind(JSON.stringify(allCardsContent), out_trade_no));
                    } else if (newOrderStatus === 1) {
                        // 修复BUG：如果是混合购物车（导致状态保持为1），但系统已经提取了自动部分的卡密，必须将卡密强制保存入库防丢失！
                        stmts.push(db.prepare("UPDATE orders SET cards_sent=? WHERE id=?").bind(JSON.stringify(allCardsContent), out_trade_no));
                    }
                    // 如果纯缺货无任何卡密产出，则什么都不做，保持 status=1

                    if (stmts.length > 0) {
                        // 批量执行发货和销售计数更新
                        await db.batch(stmts);
                    }
                    
                    // 更新自动发货商品的库存 (单独批处理，避免在主事务中出错)
                    if (autoVariantIdsToUpdate.size > 0) {
                        const stockUpdateStmts = Array.from(autoVariantIdsToUpdate).map(vid => 
                            db.prepare("UPDATE variants SET stock = (SELECT COUNT(*) FROM cards WHERE variant_id=? AND status=0) WHERE id = ?").bind(vid, vid)
                        );
                        await db.batch(stockUpdateStmts);
                    }
                    
                    // --- 5. 发送通知 ---
                    const notifications = [];
                    const dateDate = new Date((order.paid_at || Date.now()/1000) * 1000 + 28800000); 
                    const dateStr = `${dateDate.getFullYear()}/${dateDate.getMonth() + 1}/${dateDate.getDate()}`;
                    
                    // A. 管理员通知
                    const msgText = `新订单通知！
完成订单：${dateStr}
${contentBody}
----------------
总金额：${order.total_amount}元
联系方式：${order.contact}
订单号：${order.id}`;

                    // Telegram/Outlook 推送
                    if (systemConfig.tg_active === '1' && systemConfig.tg_bot_token && systemConfig.tg_chat_id) {
                        notifications.push(fetch(`https://api.telegram.org/bot${systemConfig.tg_bot_token}/sendMessage`, {
                            method: 'POST', headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ chat_id: systemConfig.tg_chat_id, text: msgText })
                        }));
                    }
                    if (systemConfig.outlook_active === '1' && systemConfig.outlook_client_id && systemConfig.outlook_refresh_token && systemConfig.mail_to) {
                        notifications.push(sendOutlookMail(db, systemConfig, 'outlook', systemConfig.mail_to, `新订单通知：${order.id}`, msgText));
                    }
                    
                    // B. [新增] 客户发货通知
                    const customerEmail = isEmail(order.contact) ? order.contact : null;
                    
                    if (customerEmail) { 
                        let isManualOrder = false;
                        if (!isCartOrder) {
                             isManualOrder = singleVariant?.auto_delivery === 0;
                        } 
                        
                        const hasDeliveredCards = allCardsContent.length > 0;
                        
                        // 修复：取消 status=2 的硬性限制，确保纯手动发货和混合购物车都能发邮件
                        if (isManualOrder || hasDeliveredCards || isCartOrder) {
                            
                            // --- 构建客户邮件内容 ---
                            let cardContentForCustomer = '';
                            let customerEmailSubject = `发货通知：您的订单 ${order.id} 已完成`;
                            
                            if (hasDeliveredCards) {
                                const cleanCards = allCardsContent.map(card => card.replace(/#\[.*?\]/g, '').trim());
                                cardContentForCustomer = cleanCards.join('\n');
                            } else if (isManualOrder) {
                                cardContentForCustomer = '该商品为手动发货，系统已扣除库存。请联系客服获取商品或等待客服手动处理。';
                            } else if (isCartOrder) {
                                // 购物车中包含手动发货商品的情况
                                if (allCardsContent.length > 0) {
                                    const cleanCards = allCardsContent.map(card => card.replace(/#\[.*?\]/g, '').trim());
                                    cardContentForCustomer = '部分商品卡密已发送：\n' + cleanCards.join('\n') + '\n\n**注意**：订单中可能包含手动发货商品，请联系客服获取未发货商品。';
                                } else {
                                    cardContentForCustomer = '您的订单为手动发货订单（或包含手动发货商品），请联系客服获取商品。';
                                }
                            } else {
                                cardContentForCustomer = '系统已完成发货操作，但无卡密内容（可能为手动发货或无卡密商品）。请联系客服获取商品。';
                            }
                            
                            let productNameForCustomer = order.product_name;
                            if (!isCartOrder) {
                                productNameForCustomer = `${order.product_name} - ${order.variant_name}`;
                            } else {
                                productNameForCustomer = `购物车合并订单`;
                            }

                            const customerMailBody = `发货通知！
完成订单：${dateStr}
商品：${productNameForCustomer}
卡密：
${cardContentForCustomer}
----------------
总金额：${order.total_amount}元
订单号：${order.id}`;

                            // --- 客户 Outlook 推送 ---
                            const c_active = systemConfig.customer_outlook_active === '1';
                            const c_client_id = systemConfig.customer_outlook_client_id;
                            const c_secret = systemConfig.customer_outlook_client_secret;
                            const c_refresh = systemConfig.customer_outlook_refresh_token;

                            if (c_active && c_client_id && c_refresh) {
                                // [修改] 直接传入 systemConfig，并指定前缀为 'customer_outlook'，确保能自动更新对应的 Token
                                notifications.push(sendOutlookMail(db, systemConfig, 'customer_outlook', customerEmail, customerEmailSubject, customerMailBody));
                            }
                        }
                    }

                    // 异步发送
                    if (notifications.length > 0 && ctx && ctx.waitUntil) {
                        ctx.waitUntil(Promise.all(notifications));
                    } else if (notifications.length > 0) {
                        Promise.all(notifications).catch(err => console.error('Notification Error:', err));
                    }
                }
            }
            return new Response('success');
        }
        if (path === '/api/notify/usdt' && method === 'POST') {
            try {
                const post = await request.json();
                const { network, tx_hash, amount, sign, timestamp, nonce, order_id } = post;

                // 获取所有激活状态下的 USDT 网关配置
                const gateways = await db.prepare("SELECT config FROM pay_gateways WHERE type LIKE 'usdt_%' AND active=1").all();
                if (!gateways || gateways.results.length === 0) return new Response(JSON.stringify({code: 404, msg: "No active USDT gateways"}));
    
                let isValidSign = false;
                for (const g of gateways.results) {
                    const config = JSON.parse(g.config);
                    const my_secret = config.app_secret || '';
                    // [安全加固·M7修复] 兼容两种签名算法：
                    // 严格模式（推荐，需 xy-usk 同步升级）：SHA256(network + tx_hash + amount + order_id + timestamp + nonce + secret)
                    // 兼容模式（旧版 xy-usk）：SHA256(network + tx_hash + amount + secret)
                    const msgCandidates = [];
                    if (order_id && timestamp && nonce) {
                        msgCandidates.push(network + tx_hash + amount + order_id + timestamp + nonce + my_secret);
                    }
                    msgCandidates.push(network + tx_hash + amount + my_secret);
                    for (const msg of msgCandidates) {
                        const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(msg));
                        const calc_sign = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
                        if (calc_sign === sign) {
                            isValidSign = true;
                            break;
                        }
                    }
                    if (isValidSign) break;
                }
    
                if (!isValidSign) return new Response(JSON.stringify({code: 403, msg: "Invalid signature"}));

                // [安全加固·M7修复] 严格模式时间戳窗口校验（±5分钟），防旧请求重放
                if (timestamp && nonce) {
                    const ts = parseInt(timestamp);
                    if (!Number.isFinite(ts) || Math.abs(time() - ts) > 300) {
                        return new Response(JSON.stringify({code: 403, msg: "Request expired"}));
                    }
                }

                // [安全加固·M7修复] 防重放：同一 tx_hash 只允许结算一次
                // （结算成功后 tx_hash 会写入 orders.trade_no，重放请求在此被拦截）
                if (!tx_hash || !sign || amount === undefined) {
                    return new Response(JSON.stringify({code: 400, msg: "Missing parameters"}));
                }
                const usedTx = await db.prepare("SELECT id FROM orders WHERE trade_no=?").bind(tx_hash).first();
                if (usedTx) return new Response(JSON.stringify({code: 403, msg: "Duplicate transaction"}));

                // 2. 精确金额匹配订单 (通过发起支付时存入 trade_no 的精确 U 金额来匹配)
                // 这样做哪怕多个人同时买同价位商品，因为尾数不同，系统也能精准发货给对的人！
                const checkOrder = await db.prepare("SELECT * FROM orders WHERE trade_no=? AND status=0 ORDER BY created_at DESC LIMIT 1").bind(String(amount)).first();
                if (!checkOrder) return new Response(JSON.stringify({code: 404, msg: "Order not found or paid"}));
                // [安全加固·M7修复] 若回调携带 order_id，必须与金额匹配到的订单一致，防止串单
                if (order_id && order_id !== checkOrder.id) {
                    return new Response(JSON.stringify({code: 403, msg: "Order mismatch"}));
                }
                const out_trade_no = checkOrder.id;

                // 3. 更新为已支付，并把 trade_no 覆盖更新为真实的链上交易哈希 tx_hash 留底
                const updateRes = await db.prepare("UPDATE orders SET status=1, paid_at=?, trade_no=? WHERE id=? AND status=0").bind(time(), tx_hash, out_trade_no).run();

                // 3. 复用发货核心
                if (updateRes.success && updateRes.meta.changes === 1) {
                    const order = await db.prepare("SELECT * FROM orders WHERE id=? AND status=1").bind(out_trade_no).first();
                    // === USDT 充值订单处理 ===
                    if (order && order.product_name === '会员充值' && order.user_id) {
                        const rechargeAmount = order.total_amount;
                        const currentBalance = (await db.prepare('SELECT balance FROM users WHERE id=?').bind(order.user_id).first()).balance || 0;
                        await db.prepare('UPDATE users SET balance=?, updated_at=? WHERE id=?').bind(currentBalance + rechargeAmount, time(), order.user_id).run();
                        await db.prepare('UPDATE users SET total_recharge = total_recharge + ?, total_incoming = total_incoming + ? WHERE id=?').bind(rechargeAmount, rechargeAmount, order.user_id).run();
                        await db.prepare('INSERT INTO balance_transactions (user_id, amount, type, description, order_id, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(order.user_id, rechargeAmount, 'recharge', '充值' + rechargeAmount + '元', out_trade_no, time()).run();
                        // [v1] 自动升级统一入口
                        await applyAutoUpgrade(db, order.user_id);
                        return new Response(JSON.stringify({code: 200, msg: "success"}));
                    }
                    if (order) {
                        const adminConfigKeys = ['tg_active', 'tg_bot_token', 'tg_chat_id', 'mail_to', 'site_name', 'outlook_active', 'outlook_client_id', 'outlook_client_secret', 'outlook_refresh_token', 'customer_outlook_active', 'customer_outlook_client_id', 'customer_outlook_client_secret', 'customer_outlook_refresh_token'];
                        const placeholders = adminConfigKeys.map(() => '?').join(',');
                        const systemConfig = {};
                        const confRes = await db.prepare(`SELECT key, value FROM site_config WHERE key IN (${placeholders})`).bind(...adminConfigKeys).all();
                        if (confRes && confRes.results) confRes.results.forEach(r => systemConfig[r.key] = r.value);

                        let contentBody = ''; const allCardsContent = []; const stmts = []; const autoVariantIdsToUpdate = new Set();
                        let newOrderStatus = 2; const isCartOrder = order.variant_id === 0; let singleVariant;

                        try {
                            if (isCartOrder) {
                                const cartItems = JSON.parse(order.cards_sent || '[]');
                                for (const item of cartItems) {
                                    const variant = await db.prepare("SELECT auto_delivery, stock FROM variants WHERE id=?").bind(item.variantId).first();
                                    if (!variant) continue;
                                    if (variant.auto_delivery === 1) {
                                        let cards;
                                        if (item.buyMode === 'select' && item.selectedCardId) {
                                            cards = await db.prepare("UPDATE cards SET status=1, order_id=? WHERE id=? AND status=0 RETURNING id, content").bind(out_trade_no, item.selectedCardId).all();
                                        } else {
                                            cards = await db.prepare("UPDATE cards SET status=1, order_id=? WHERE id IN (SELECT id FROM cards WHERE variant_id=? AND status=0 LIMIT ?) RETURNING id, content").bind(out_trade_no, item.variantId, item.quantity).all();
                                        }
                                        if (cards.results.length >= item.quantity) {
                                            allCardsContent.push(...cards.results.map(c => `【${item.productName} - ${item.variantName}】\n${stripCardNote(c.content)}`));
                                            stmts.push(db.prepare("UPDATE variants SET sales_count = sales_count + ? WHERE id=?").bind(item.quantity, item.variantId));
                                            autoVariantIdsToUpdate.add(item.variantId);
                                        } else newOrderStatus = 1; 
                                    } else {
                                        await db.prepare("UPDATE variants SET stock = stock - ?, sales_count = sales_count + ? WHERE id=? AND stock >= ?").bind(item.quantity, item.quantity, item.variantId, item.quantity).run();
                                        allCardsContent.push(`【${item.productName} - ${item.variantName}】\n该商品为手动发货，请联系客服处理。`);
                                        newOrderStatus = 1; 
                                    }
                                }
                            } else {
                                singleVariant = await db.prepare("SELECT auto_delivery, stock FROM variants WHERE id=?").bind(order.variant_id).first();
                                if (singleVariant.auto_delivery === 1) {
                                    let targetId = null; try { targetId = JSON.parse(order.cards_sent).target_id; } catch(e){}
                                    let cards;
                                    if (targetId) cards = await db.prepare("UPDATE cards SET status=1, order_id=? WHERE id=? AND status=0 RETURNING id, content").bind(out_trade_no, targetId).all();
                                    else cards = await db.prepare("UPDATE cards SET status=1, order_id=? WHERE id IN (SELECT id FROM cards WHERE variant_id=? AND status=0 LIMIT ?) RETURNING id, content").bind(out_trade_no, order.variant_id, order.quantity).all();
                                    
                                    if (cards.results.length >= order.quantity) {
                                        allCardsContent.push(...cards.results.map(c => stripCardNote(c.content)));
                                        stmts.push(db.prepare("UPDATE variants SET sales_count = sales_count + ? WHERE id=?").bind(order.quantity, order.variant_id));
                                        autoVariantIdsToUpdate.add(order.variant_id);
                                    } else newOrderStatus = 1;
                                } else {
                                    await db.prepare("UPDATE variants SET stock = stock - ?, sales_count = sales_count + ? WHERE id=? AND stock >= ?").bind(order.quantity, order.quantity, order.variant_id, order.quantity).run();
                                    allCardsContent.push(`【${order.product_name} - ${order.variant_name}】\n该商品为手动发货，请联系客服处理。`);
                                    newOrderStatus = 1;
                                }
                            }
                        } catch (e) { newOrderStatus = 1; }

                        if (newOrderStatus === 2) stmts.push(db.prepare("UPDATE orders SET status=2, cards_sent=? WHERE id=?").bind(JSON.stringify(allCardsContent), out_trade_no));
                        else if (newOrderStatus === 1) stmts.push(db.prepare("UPDATE orders SET cards_sent=? WHERE id=?").bind(JSON.stringify(allCardsContent), out_trade_no));
                        if (stmts.length > 0) await db.batch(stmts);
                    }
                }
                return new Response(JSON.stringify({code: 200, msg: "success"}));
            } catch (e) {
                return new Response(JSON.stringify({code: 500, msg: e.message}));
            }
        }

        // ====== 易支付异步回调 ======
        if (path === '/api/notify/yipay' && method === 'POST') {
            try {
                // 易支付回调参数可能在 query 或 body 中
                const formData = await request.formData();
                const params = {};
                for (const [key, value] of formData.entries()) {
                    params[key] = value;
                }
                // 如果 formData 为空，尝试从 URL query 获取
                if (Object.keys(params).length === 0) {
                    url.searchParams.forEach((v, k) => { params[k] = v; });
                }

                // [dujiao-next 兼容] out_trade_no = 本站订单号，trade_no = 易支付网关流水号
                const out_trade_no = params.out_trade_no || params.trade_no;
                const tradeStatus = params.trade_status;

                if (!out_trade_no) return new Response('fail');
                // 与 dujiao-next VerifyCallback 一致：TRADE_SUCCESS / TRADE_FINISHED 均视为支付成功
                if (tradeStatus !== 'TRADE_SUCCESS' && tradeStatus !== 'TRADE_FINISHED') return new Response('success');

                // 查找对应订单和支付网关配置
                const order = await db.prepare("SELECT * FROM orders WHERE id=? AND status=0").bind(out_trade_no).first();
                if (!order) return new Response('success');

                // 获取易支付网关配置 (优先按订单绑定的网关，找不到再按类型兜底)
                let gwConfig = null;
                const gateway = await db.prepare("SELECT config FROM pay_gateways WHERE type='yipay' AND active=1 AND id=?").bind(order.payment_method).first();
                if (gateway) {
                    gwConfig = JSON.parse(gateway.config);
                } else {
                    const anyGw = await db.prepare("SELECT config FROM pay_gateways WHERE type='yipay' AND active=1").first();
                    if (!anyGw) return new Response('fail');
                    gwConfig = JSON.parse(anyGw.config);
                }

                // 1. 验签 (v1 MD5 / v2 RSA，与 dujiao-next VerifyCallback 一致)
                const signOk = await verifyEpayCallback(gwConfig, params);
                if (!signOk) {
                    console.error('YiPay Notify: Signature verification failed');
                    return new Response('fail');
                }

                // 2. 归属校验 (与 dujiao-next VerifyCallbackOwnership 一致)：防止跨商户回调注入
                const callbackPid = String(params.pid || '').trim();
                if (!callbackPid || callbackPid !== String(gwConfig.merchant_id || '').trim()) {
                    console.error('YiPay Notify: Merchant ID (pid) mismatch');
                    return new Response('fail');
                }

                // 3. 金额校验：金额缺失或不匹配均拒绝（防止不带金额的回调绕过校验）
                if (!params.money || parseFloat(params.money) !== parseFloat(order.total_amount)) {
                    console.error('YiPay Notify: Amount mismatch or missing');
                    return new Response('fail');
                }

                // 更新订单状态为已支付
                const updateRes = await db.prepare("UPDATE orders SET status=1, paid_at=?, trade_no=? WHERE id=? AND status=0")
                    .bind(time(), params.trade_no || out_trade_no, out_trade_no).run();

                if (!updateRes.success || updateRes.meta.changes !== 1) {
                    return new Response('success');
                }

                // === 复用发货核心逻辑 ===
                const paidOrder = await db.prepare("SELECT * FROM orders WHERE id=? AND status=1").bind(out_trade_no).first();
                // === YiPay 充值订单处理 ===
                if (paidOrder && paidOrder.product_name === '会员充值' && paidOrder.user_id) {
                    const rechargeAmount = paidOrder.total_amount;
                    const currentBalance = (await db.prepare('SELECT balance FROM users WHERE id=?').bind(paidOrder.user_id).first()).balance || 0;
                    await db.prepare('UPDATE users SET balance=?, updated_at=? WHERE id=?').bind(currentBalance + rechargeAmount, time(), paidOrder.user_id).run();
                    await db.prepare('UPDATE users SET total_recharge = total_recharge + ?, total_incoming = total_incoming + ? WHERE id=?').bind(rechargeAmount, rechargeAmount, paidOrder.user_id).run();
                    await db.prepare('INSERT INTO balance_transactions (user_id, amount, type, description, order_id, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(paidOrder.user_id, rechargeAmount, 'recharge', '充值' + rechargeAmount + '元', out_trade_no, time()).run();
                    // [v1] 自动升级统一入口
                    await applyAutoUpgrade(db, paidOrder.user_id);
                    return new Response('success');
                }
                if (paidOrder) {
                    const adminConfigKeys = ['tg_active', 'tg_bot_token', 'tg_chat_id', 'mail_to', 'site_name', 'outlook_active', 'outlook_client_id', 'outlook_client_secret', 'outlook_refresh_token', 'customer_outlook_active', 'customer_outlook_client_id', 'customer_outlook_client_secret', 'customer_outlook_refresh_token'];
                    const placeholders = adminConfigKeys.map(() => '?').join(',');
                    const systemConfig = {};
                    const confRes = await db.prepare(`SELECT key, value FROM site_config WHERE key IN (${placeholders})`).bind(...adminConfigKeys).all();
                    if (confRes && confRes.results) confRes.results.forEach(r => systemConfig[r.key] = r.value);

                    let contentBody = ''; const allCardsContent = []; const stmts = []; const autoVariantIdsToUpdate = new Set();
                    let newOrderStatus = 2; const isCartOrder = paidOrder.variant_id === 0; let singleVariant;

                    try {
                        if (isCartOrder) {
                            const cartItems = JSON.parse(paidOrder.cards_sent || '[]');
                            for (const item of cartItems) {
                                const variant = await db.prepare("SELECT auto_delivery, stock FROM variants WHERE id=?").bind(item.variantId).first();
                                if (!variant) continue;
                                if (variant.auto_delivery === 1) {
                                    let cards;
                                    if (item.buyMode === 'select' && item.selectedCardId) {
                                        cards = await db.prepare("UPDATE cards SET status=1, order_id=? WHERE id=? AND status=0 RETURNING id, content").bind(out_trade_no, item.selectedCardId).all();
                                    } else {
                                        cards = await db.prepare("UPDATE cards SET status=1, order_id=? WHERE id IN (SELECT id FROM cards WHERE variant_id=? AND status=0 LIMIT ?) RETURNING id, content").bind(out_trade_no, item.variantId, item.quantity).all();
                                    }
                                    if (cards.results.length >= item.quantity) {
                                        allCardsContent.push(...cards.results.map(c => `【${item.productName} - ${item.variantName}】\n${stripCardNote(c.content)}`));
                                        stmts.push(db.prepare("UPDATE variants SET sales_count = sales_count + ? WHERE id=?").bind(item.quantity, item.variantId));
                                        autoVariantIdsToUpdate.add(item.variantId);
                                    } else newOrderStatus = 1;
                                } else {
                                    await db.prepare("UPDATE variants SET stock = stock - ?, sales_count = sales_count + ? WHERE id=? AND stock >= ?").bind(item.quantity, item.quantity, item.variantId, item.quantity).run();
                                    allCardsContent.push(`【${item.productName} - ${item.variantName}】\n该商品为手动发货，请联系客服处理。`);
                                    newOrderStatus = 1;
                                }
                            }
                        } else {
                            singleVariant = await db.prepare("SELECT auto_delivery, stock FROM variants WHERE id=?").bind(paidOrder.variant_id).first();
                            if (singleVariant.auto_delivery === 1) {
                                let targetId = null; try { targetId = JSON.parse(paidOrder.cards_sent).target_id; } catch(e){}
                                let cards;
                                if (targetId) cards = await db.prepare("UPDATE cards SET status=1, order_id=? WHERE id=? AND status=0 RETURNING id, content").bind(out_trade_no, targetId).all();
                                else cards = await db.prepare("UPDATE cards SET status=1, order_id=? WHERE id IN (SELECT id FROM cards WHERE variant_id=? AND status=0 LIMIT ?) RETURNING id, content").bind(out_trade_no, paidOrder.variant_id, paidOrder.quantity).all();
                                if (cards.results.length >= paidOrder.quantity) {
                                    allCardsContent.push(...cards.results.map(c => stripCardNote(c.content)));
                                    stmts.push(db.prepare("UPDATE variants SET sales_count = sales_count + ? WHERE id=?").bind(paidOrder.quantity, paidOrder.variant_id));
                                    autoVariantIdsToUpdate.add(paidOrder.variant_id);
                                } else newOrderStatus = 1;
                            } else {
                                await db.prepare("UPDATE variants SET stock = stock - ?, sales_count = sales_count + ? WHERE id=? AND stock >= ?").bind(paidOrder.quantity, paidOrder.quantity, paidOrder.variant_id, paidOrder.quantity).run();
                                allCardsContent.push('该商品为手动发货，请联系客服处理。');
                                newOrderStatus = 1;
                            }
                        }
                    } catch (e) {
                        console.error('YiPay Fulfillment Error:', e);
                        newOrderStatus = 1;
                    }

                    if (newOrderStatus === 2) {
                        stmts.push(db.prepare("UPDATE orders SET status=2, cards_sent=? WHERE id=?").bind(JSON.stringify(allCardsContent), out_trade_no));
                    } else if (newOrderStatus === 1 && allCardsContent.length > 0) {
                        stmts.push(db.prepare("UPDATE orders SET cards_sent=? WHERE id=?").bind(JSON.stringify(allCardsContent), out_trade_no));
                    }
                    if (stmts.length > 0) await db.batch(stmts);
                    if (autoVariantIdsToUpdate.size > 0) {
                        await db.batch(Array.from(autoVariantIdsToUpdate).map(vid =>
                            db.prepare("UPDATE variants SET stock = (SELECT COUNT(*) FROM cards WHERE variant_id=? AND status=0) WHERE id = ?").bind(vid, vid)
                        ));
                    }

                    // 发送通知
                    const msgText = `【易支付】新订单完成！\n订单号：${out_trade_no}\n金额：${paidOrder.total_amount}元\n联系方式：${paidOrder.contact}`;
                    if (systemConfig.tg_active === '1' && systemConfig.tg_bot_token && systemConfig.tg_chat_id) {
                        fetch(`https://api.telegram.org/bot${systemConfig.tg_bot_token}/sendMessage`, {
                            method: 'POST', headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ chat_id: systemConfig.tg_chat_id, text: msgText })
                        }).catch(e => console.error('TG notify error:', e));
                    }
                }

                return new Response('success');
            } catch (e) {
                console.error('YiPay Notify Error:', e);
                return new Response('fail');
            }
        }
    } catch (e) {
        console.error('API Error:', e);
        return errRes('服务器内部处理异常，请稍后再试或联系系统管理员', 500);
    }
    return errRes('API Not Found', 404);
}

// === 辅助函数：Outlook Graph API 发信 (支持自动刷新管理员和客户令牌) ===
async function sendOutlookMail(db, config, keyPrefix, toEmail, subject, content) {
    try {
        // 兼容处理：如果未传入 keyPrefix，默认尝试读取 outlook_ 前缀
        const p = keyPrefix || 'outlook';
        
        // 动态读取配置：根据前缀 (outlook 或 customer_outlook) 读取对应的 ID/Secret/Token
        const clientId = config[`${p}_client_id`] || config.outlook_client_id;
        const clientSecret = config[`${p}_client_secret`] || config.outlook_client_secret || '';
        const refreshToken = config[`${p}_refresh_token`] || config.outlook_refresh_token;

        // 1. 获取 Access Token
        const tokenUrl = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
        const params = new URLSearchParams();
        params.append('client_id', clientId);
        params.append('client_secret', clientSecret);
        params.append('refresh_token', refreshToken);
        params.append('grant_type', 'refresh_token');
        params.append('scope', 'Mail.Send offline_access');

        const tokenRes = await fetch(tokenUrl, { method: 'POST', body: params });
        const tokenData = await tokenRes.json();

        if (!tokenData.access_token) {
            console.error(`Outlook Auth Error (${p}):`, tokenData);
            return;
        }

        // 2. [核心] 自动更新 Refresh Token 到数据库
        // 只有当 db 存在，且返回了新的 refresh_token 时才执行
        if (tokenData.refresh_token && tokenData.refresh_token !== refreshToken && db) {
            try {
                // 构造数据库的键名 (例如 outlook_refresh_token 或 customer_outlook_refresh_token)
                const dbKey = `${p}_refresh_token`;
                
                await db.prepare(`
                    INSERT INTO site_config (key, value) VALUES (?, ?) 
                    ON CONFLICT(key) DO UPDATE SET value = excluded.value
                `).bind(dbKey, tokenData.refresh_token).run();
                
                console.log(`Refreshed token for ${dbKey} saved to DB.`);
            } catch (e) { 
                console.error('DB Update Error:', e); 
            }
        }

        // 3. 发送邮件
        const mailUrl = 'https://graph.microsoft.com/v1.0/me/sendMail';
        await fetch(mailUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${tokenData.access_token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                message: {
                    subject: subject,
                    body: { contentType: "Html", content: content.replace(/\n/g, '<br>') },
                    toRecipients: [{ emailAddress: { address: toEmail } }]
                },
                saveToSentItems: "false"
            })
        });
        
    } catch (e) {
        console.error(`Outlook Send Error (${keyPrefix}):`, e);
    }
}

// === 辅助函数：测试 Outlook 连接 (支持机密客户端和公共客户端) ===
async function testOutlookConnection(clientId, clientSecret, refreshToken, toEmail) {
    // 1. 尝试获取 Access Token
    const tokenUrl = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
    const params = new URLSearchParams();
    params.append('client_id', clientId);
    if (clientSecret) params.append('client_secret', clientSecret);
    params.append('refresh_token', refreshToken);
    params.append('grant_type', 'refresh_token');
    params.append('scope', 'Mail.Send offline_access');

    const tokenRes = await fetch(tokenUrl, { method: 'POST', body: params });
    const tokenData = await tokenRes.json();

    if (!tokenData.access_token) {
        const errMsg = tokenData.error_description || tokenData.error || '未知错误';
        return { success: false, message: `获取 Access Token 失败: ${errMsg}` };
    }

    // 2. 发送测试邮件
    const testSubject = '【测试邮件】Outlook Graph API 连接正常';
    const testBody = `<div style="font-family:sans-serif;padding:20px;">
        <h3 style="color:#409EFF;">✅ Outlook Graph API 测试成功</h3>
        <p>这是一封由系统自动发送的测试邮件，说明您的 Outlook 发信配置正确。</p>
        <hr style="border:none;border-top:1px solid #eee;margin:16px 0;">
        <p style="color:#888;font-size:12px;">发送时间：${new Date().toISOString().replace('T', ' ').substring(0, 19)} UTC</p>
        <p style="color:#888;font-size:12px;">认证模式：${clientSecret ? '机密客户端 (Client Secret)' : '公共客户端 (无 Secret)'}</p>
    </div>`;

    const mailUrl = 'https://graph.microsoft.com/v1.0/me/sendMail';
    const mailRes = await fetch(mailUrl, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${tokenData.access_token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            message: {
                subject: testSubject,
                body: { contentType: 'Html', content: testBody },
                toRecipients: [{ emailAddress: { address: toEmail } }]
            },
            saveToSentItems: 'false'
        })
    });

    if (mailRes.ok) {
        return { success: true, message: `测试邮件已成功发送至 ${toEmail}，请检查收件箱（含垃圾邮件）。认证模式：${clientSecret ? '机密客户端' : '公共客户端'}` };
    } else {
        const errData = await mailRes.json().catch(() => ({}));
        const errMsg = errData?.error?.message || `HTTP ${mailRes.status}`;
        return { success: false, message: `Token 获取成功，但发送邮件失败: ${errMsg}` };
    }
}
