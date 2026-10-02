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
    const user = await db.prepare('SELECT id, username, email, balance, frozen, member_level, created_at, updated_at FROM users WHERE id=?').bind(userId).first();
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
        if (path.startsWith('/admin/') || path.startsWith('/themes/') || path.startsWith('/assets/')) {
             return env.ASSETS.fetch(request);
        }

        // === 会员页面路由 ===
        if (path === '/member/login') {
            const newUrl = new URL('/member/login.html', url.origin);
            const internalReq = new Request(newUrl, { method: request.method, headers: { 'X-Internal-Asset': '1' } });
            return env.ASSETS.fetch(internalReq);
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
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email)',
        'ALTER TABLE orders ADD COLUMN user_id INTEGER',
        // [性能优化] 会员列表/详情的关联查询走索引，避免 orders 增长后逐行全表扫描
        'CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id)',
        'CREATE INDEX IF NOT EXISTS idx_balance_transactions_user_id ON balance_transactions(user_id)',
        'CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at)'
    ]) {
        try { await db.prepare(ddl).run(); } catch(e) {}
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
    _productSchemaEnsured = true;
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
        if (path.startsWith('/api/admin/product') || path.startsWith('/api/shop/product') || path === '/api/shop/order/create' || path === '/api/shop/cart/checkout') {
            await ensureProductColumns(db);
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
                const now = Math.floor(Date.now() / 1000);
                const today = new Date().setHours(0,0,0,0) / 1000;
                const week = now - 7 * 86400;   // 最近7天
                const month = now - 30 * 86400; // 最近30天
                const year = now - 365 * 86400; // 最近一年

                // 使用 Promise.all 并发查询，提高速度
                const [
                    r_o_today, r_o_week, r_o_month,
                    r_i_today, r_i_week, r_i_month, r_i_year,
                    r_cards, r_pending
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
                    db.prepare("SELECT COUNT(*) as c FROM orders WHERE status = 0").first()
                ]);

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
                    orders_pending: r_pending.c
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
                    await db.prepare("UPDATE categories SET name=?, sort=?, image_url=? WHERE id=?").bind(name, sort, image_url, id).run();
                } else {
                    await db.prepare("INSERT INTO categories (name, sort, image_url) VALUES (?, ?, ?)").bind(name, sort, image_url).run();
                }
                return jsonRes({ success: true });
            }
            if (path === '/api/admin/category/delete' && method === 'POST') {
                const { id } = await request.json();
                if (id === 1) return errRes('默认分类不能删除');
                await db.prepare("UPDATE products SET category_id = 1 WHERE category_id = ?").bind(id).run();
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
                const memberPriceVal = enabled ? 1 : 0;
                await db.prepare("UPDATE products SET member_price_enabled=? WHERE id=?").bind(memberPriceVal, id).run();
                return jsonRes({ success: true, member_price_enabled: memberPriceVal });
            }

            // 商品保存逻辑 (含 tags 支持)
            if (path === '/api/admin/product/save' && method === 'POST') {
                const data = await request.json();
                let productId = data.id;
                const now = time();

                // 1. 保存主商品 (增加 tags / seo_description / member_price_enabled 字段)
                const memberPriceEnabled = data.member_price_enabled === 0 ? 0 : 1; // 默认开启会员价
                if (productId) {
                    await db.prepare("UPDATE products SET name=?, description=?, category_id=?, sort=?, active=?, image_url=?, tags=?, seo_description=?, member_price_enabled=? WHERE id=?")
                        .bind(data.name, data.description, data.category_id, data.sort, data.active, data.image_url, data.tags, data.seo_description, memberPriceEnabled, productId).run();
                } else {
                    const res = await db.prepare("INSERT INTO products (category_id, sort, active, created_at, name, description, image_url, tags, seo_description, member_price_enabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
                        .bind(data.category_id, data.sort, data.active, now, data.name, data.description, data.image_url, data.tags, data.seo_description, memberPriceEnabled).run();
                    productId = res.meta.last_row_id;
                }

                // 2. 处理规格
                const existingVariants = (await db.prepare("SELECT id FROM variants WHERE product_id=?").bind(productId).all()).results;
                const newVariantIds = [];
                const updateStmts = [];
                
                // 增加 selection_label 和 random_mode_text 字段
                const insertStmt = db.prepare(`
                    INSERT INTO variants (product_id, name, price, stock, color, image_url, wholesale_config, custom_markup, auto_delivery, sales_count, created_at, random_mode_text, selection_label, sort, active) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `);
                const updateStmt = db.prepare(`
                    UPDATE variants SET name=?, price=?, stock=?, color=?, image_url=?, wholesale_config=?, custom_markup=?, auto_delivery=?, sales_count=?, random_mode_text=?, selection_label=?, sort=?, active=?
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
                                v.sort || 0, v.active,
                                variantId, productId
                            )
                        );
                    } else { // 插入
                        updateStmts.push(
                            insertStmt.bind(
                                productId, v.name, v.price, stock, v.color, v.image_url, wholesale_config_json,
                                v.custom_markup || 0, auto_delivery, v.sales_count || 0, now,
                                v.random_mode_text || null, v.selection_label || null,
                                v.sort || 0, v.active
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
                    const catStmts = needCats.map(c => db.prepare("INSERT INTO categories (name, sort, image_url) VALUES (?, ?, ?)").bind(c.name, c.sort, c.image_url));
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
                        vStmts.push(db.prepare("INSERT INTO variants (product_id, name, price, stock, color, image_url, wholesale_config, custom_markup, sales_count, auto_delivery, created_at, selection_label, sort, active, random_mode_text) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
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
                                v.random_mode_text || null
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
                            SET stock = (SELECT COUNT(*) FROM cards WHERE variant_id = variants.id AND status = 0)
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
                const { username, email, password, balance, member_level } = await request.json();
                if (!email || !password) return errRes('邮箱和密码不能为空');
                // [安全加固] 邮箱白名单字符，与注册接口保持一致
                if (!/^[A-Za-z0-9._%+\-\u4e00-\u9fa5]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/.test(email)) return errRes('请输入有效的邮箱地址');
                if (password.length < 6) return errRes('密码不能少于6位');
                if (password.length > 64) return errRes('密码不能超过64位');
                const initialBalance = parseFloat(balance) || 0;
                if (initialBalance < 0) return errRes('初始余额不能为负数');
                const initialLevel = parseInt(member_level) || 0;
                if (initialLevel < 0) return errRes('等级不能为负数');
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
                const result = await db.prepare('INSERT INTO users (username, password_hash, password_encrypted, email, balance, frozen, member_level, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)').bind(finalUsername, passwordHash, passwordEncrypted, email, initialBalance, initialLevel, now, now).run();
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
                let query = 'SELECT u.id, u.username, u.email, u.balance, u.frozen, u.member_level, u.total_recharge, u.created_at, u.updated_at, (SELECT COUNT(*) FROM orders WHERE user_id=u.id) as order_count FROM users u';
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
                const user = await db.prepare('SELECT id, username, email, balance, frozen, member_level, total_recharge, password_encrypted, created_at, updated_at FROM users WHERE id=?').bind(id).first();
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
                if (member_level < 0) return errRes('等级不能为负数');
                const member = await db.prepare('SELECT id FROM users WHERE id=?').bind(user_id).first();
                if (!member) return errRes('会员不存在');
                await db.prepare('UPDATE users SET member_level=?, updated_at=? WHERE id=?').bind(member_level, time(), user_id).run();
                return jsonRes({ success: true, member_level });
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
                await db.prepare('CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, count INTEGER DEFAULT 1, first_attempt INTEGER NOT NULL)').run();
                const rateRow = await db.prepare('SELECT count, first_attempt FROM rate_limits WHERE key=?').bind(captchaRateKey).first();
                if (rateRow && (nowTs - rateRow.first_attempt) < windowSeconds && rateRow.count >= maxRequests) {
                    const remain = windowSeconds - (nowTs - rateRow.first_attempt);
                    return errRes('验证码请求过于频繁，请 ' + remain + ' 秒后重试', 429);
                }
                if (!rateRow || (nowTs - rateRow.first_attempt) >= windowSeconds) {
                    await db.prepare("INSERT INTO rate_limits (key, count, first_attempt) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count=1, first_attempt=excluded.first_attempt").bind(captchaRateKey, nowTs).run();
                } else {
                    await db.prepare("UPDATE rate_limits SET count=count+1 WHERE key=?").bind(captchaRateKey).run();
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
            if (!amount || amount < 1) return errRes('充值金额最低1元');
            if (amount > 10000) return errRes('单次充值不能超过10000元');
            if (!payment_method) return errRes('请选择支付方式');
            // 校验支付方式必须开启了"会员充值"开关
            await ensurePayGatewayColumns(db);
            const rechargeGw = await db.prepare("SELECT id FROM pay_gateways WHERE id=? AND active=1 AND member_recharge=1").bind(payment_method).first()
                || await db.prepare("SELECT id FROM pay_gateways WHERE type=? AND active=1 AND member_recharge=1").bind(payment_method).first();
            if (!rechargeGw) return errRes('该支付方式未开启会员充值或不可用');
            const order_id = uuid();
            const now = time();
            const contact = user.email || user.username;
            await db.prepare('INSERT INTO orders (id, variant_id, product_name, variant_name, price, quantity, total_amount, contact, query_password, payment_method, created_at, status, user_id) VALUES (?, 0, ?, ?, ?, 1, ?, ?, ?, ?, ?, 0, ?)').bind(order_id, '会员充值', '充值' + amount + '元', amount, amount.toFixed(2), contact, 'balance_recharge', payment_method, now, user.id).run();
            return jsonRes({ order_id, total_amount: amount.toFixed(2), payment_method });
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
            // 充值/消费后自动升级检查
            try {
                const enabledRow = await db.prepare("SELECT value FROM site_config WHERE key='member_enabled'").first();
                if (enabledRow && enabledRow.value === '1') {
                    const rulesRow = await db.prepare("SELECT value FROM site_config WHERE key='member_upgrade_rules'").first();
                    if (rulesRow && rulesRow.value) {
                        const rules = JSON.parse(rulesRow.value);
                        const userData = await db.prepare('SELECT total_recharge, member_level FROM users WHERE id=?').bind(user.id).first();
                        if (userData && rules.length > 0) {
                            let newLevel = userData.member_level || 0;
                            for (const rule of rules) {
                                if (userData.total_recharge >= rule.amount && rule.level > newLevel) {
                                    newLevel = rule.level;
                                }
                            }
                            if (newLevel > (userData.member_level || 0)) {
                                await db.prepare('UPDATE users SET member_level=? WHERE id=?').bind(newLevel, user.id).run();
                            }
                        }
                    }
                }
            } catch(e) { console.error('Auto upgrade check failed:', e); }
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
                            // 获取会员折扣
                            const memberEnabledRow = await db.prepare("SELECT value FROM site_config WHERE key='member_enabled'").first();
                            if (memberEnabledRow && memberEnabledRow.value === '1') {
                                const userRow = await db.prepare('SELECT member_level FROM users WHERE id=?').bind(mUserId).first();
                                const userLevel = (userRow && userRow.member_level) ? userRow.member_level : 0;
                                const levelsRow = await db.prepare("SELECT value FROM site_config WHERE key='member_levels'").first();
                                if (levelsRow && levelsRow.value) {
                                    try {
                                        const levels = JSON.parse(levelsRow.value);
                                        if (levels[userLevel] && levels[userLevel].discount) {
                                            const d = parseInt(levels[userLevel].discount);
                                            if (d >= 1 && d < 100) memberDiscount = d;
                                        }
                                    } catch(e) {}
                                }
                            }
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
            let finalPrice = variant.price;
            
            if (card_id) {
                // 1. 自选模式：基础价 + 加价 (忽略批发价)
                if (variant.custom_markup > 0) finalPrice += variant.custom_markup;
            } else {
                // 2. 随机模式：应用批发价
                if (variant.wholesale_config) {
                    try {
                        const wholesaleConfig = JSON.parse(variant.wholesale_config);
                        wholesaleConfig.sort((a, b) => b.qty - a.qty);
                        for (const rule of wholesaleConfig) {
                            if (finalQuantity >= rule.qty) {
                                finalPrice = rule.price; 
                                break;
                            }
                        }
                    } catch(e) {}
                }
            }
            
            // 如果指定了卡密，暂存在 cards_sent 字段中
            let cardsSentPlaceholder = null;
            if (card_id) cardsSentPlaceholder = JSON.stringify({ target_id: card_id });

            // 记录原价，再应用会员折扣（商品未开启“会员价”时不享受折扣）
            const originalPrice = finalPrice;
            const memberPriceOn = !product || product.member_price_enabled !== 0;
            if (memberDiscount < 100 && memberPriceOn) {
                finalPrice = Math.round(finalPrice * memberDiscount / 100 * 100) / 100;
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
                            const memberEnabledRow2 = await db.prepare("SELECT value FROM site_config WHERE key='member_enabled'").first();
                            if (memberEnabledRow2 && memberEnabledRow2.value === '1') {
                                const userRow2 = await db.prepare('SELECT member_level FROM users WHERE id=?').bind(mUserId).first();
                                const userLevel2 = (userRow2 && userRow2.member_level) ? userRow2.member_level : 0;
                                const levelsRow2 = await db.prepare("SELECT value FROM site_config WHERE key='member_levels'").first();
                                if (levelsRow2 && levelsRow2.value) {
                                    try {
                                        const levels2 = JSON.parse(levelsRow2.value);
                                        if (levels2[userLevel2] && levels2[userLevel2].discount) {
                                            const d = parseInt(levels2[userLevel2].discount);
                                            if (d >= 1 && d < 100) memberDiscount = d;
                                        }
                                    } catch(e) {}
                                }
                            }
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
                let finalPrice = variant.price; // 从数据库重新计算

                if (item.buyMode === 'select' && item.selectedCardId) {
                    // 1. 自选模式
                    if (variant.auto_delivery !== 1) throw new Error('手动发货商品不支持自选');
                    const targetCard = await db.prepare("SELECT id FROM cards WHERE id=? AND variant_id=? AND status=0")
                        .bind(item.selectedCardId, item.variantId).first();
                    if (!targetCard) throw new Error(`商品 ${item.variantName} 的自选号码已被抢走`);
                    stock = 1; // 足够
                    
                    // 重新计算自选价格
                    finalPrice = variant.price;
                    if (variant.custom_markup > 0) finalPrice += variant.custom_markup;
                    
                } else {
                    // 2. 随机/手动 模式
                    if (variant.auto_delivery === 1) {
                        stock = (await db.prepare("SELECT COUNT(*) as c FROM cards WHERE variant_id=? AND status=0").bind(item.variantId).first()).c;
                    } else {
                        stock = variant.stock;
                    }
                    if (stock < item.quantity) throw new Error(`商品 ${item.variantName} 库存不足 (仅剩 ${stock} 件)`);
                    
                    // 2b. 重新计算批发价 (仅随机模式)
                    finalPrice = variant.price;
                    if (variant.wholesale_config) {
                        try {
                            const wholesaleConfig = JSON.parse(variant.wholesale_config);
                            wholesaleConfig.sort((a, b) => b.qty - a.qty);
                            for (const rule of wholesaleConfig) {
                                if (item.quantity >= rule.qty) {
                                    finalPrice = rule.price; 
                                    break;
                                }
                            }
                        } catch(e) {}
                    }
                }
                
                total_amount += (finalPrice * item.quantity);
                
                // 存储验证后的信息
                validatedItems.push({
                    variantId: variant.id,
                    productName: product ? product.name : '未知商品',
                    variantName: variant.name,
                    quantity: item.quantity,
                    price: finalPrice, // 使用后端计算的单价
                    buyMode: item.buyMode,
                    selectedCardId: item.selectedCardId,
                    auto_delivery: variant.auto_delivery, // 存储发货类型
                    memberPriceEnabled: !product || product.member_price_enabled !== 0 // 商品级会员价开关（仅用于折扣计算，不入库）
                });
            }

            // 获取会员 user_id 并应用会员折扣
            // (已在上方提前检测)

            // 应用会员折扣（未开启“会员价”的商品不享受折扣）
            if (memberDiscount < 100) {
                for (const vi of validatedItems) {
                    if (vi.memberPriceEnabled) vi.price = Math.round(vi.price * memberDiscount / 100 * 100) / 100;
                    delete vi.memberPriceEnabled;
                }
                total_amount = validatedItems.reduce((sum, vi) => sum + vi.price * vi.quantity, 0);
            } else {
                for (const vi of validatedItems) delete vi.memberPriceEnabled;
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

            return jsonRes({ order_id, total_amount, payment_method });
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
                    await db.prepare('UPDATE users SET total_recharge = total_recharge + ? WHERE id=?').bind(rechargeAmount, order.user_id).run();
                    await db.prepare('INSERT INTO balance_transactions (user_id, amount, type, description, order_id, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(order.user_id, rechargeAmount, 'recharge', '充值' + rechargeAmount + '元', out_trade_no, time()).run();
                    try {
                        const enRow = await db.prepare("SELECT value FROM site_config WHERE key='member_enabled'").first();
                        if (enRow && enRow.value === '1') {
                            const rlRow = await db.prepare("SELECT value FROM site_config WHERE key='member_upgrade_rules'").first();
                            if (rlRow && rlRow.value) {
                                const rules = JSON.parse(rlRow.value);
                                const ud = await db.prepare('SELECT total_recharge, member_level FROM users WHERE id=?').bind(order.user_id).first();
                                if (ud && rules.length > 0) {
                                    let nl = ud.member_level || 0;
                                    for (const r of rules) { if (ud.total_recharge >= r.amount && r.level > nl) nl = r.level; }
                                    if (nl > (ud.member_level || 0)) await db.prepare('UPDATE users SET member_level=? WHERE id=?').bind(nl, order.user_id).run();
                                }
                            }
                        }
                    } catch(e) {}
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
                        await db.prepare('UPDATE users SET total_recharge = total_recharge + ? WHERE id=?').bind(rechargeAmount, order.user_id).run();
                        await db.prepare('INSERT INTO balance_transactions (user_id, amount, type, description, order_id, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(order.user_id, rechargeAmount, 'recharge', '充值' + rechargeAmount + '元', out_trade_no, time()).run();
                        try {
                            const enRow2 = await db.prepare("SELECT value FROM site_config WHERE key='member_enabled'").first();
                            if (enRow2 && enRow2.value === '1') {
                                const rlRow2 = await db.prepare("SELECT value FROM site_config WHERE key='member_upgrade_rules'").first();
                                if (rlRow2 && rlRow2.value) {
                                    const rules2 = JSON.parse(rlRow2.value);
                                    const ud2 = await db.prepare('SELECT total_recharge, member_level FROM users WHERE id=?').bind(order.user_id).first();
                                    if (ud2 && rules2.length > 0) {
                                        let nl2 = ud2.member_level || 0;
                                        for (const r of rules2) { if (ud2.total_recharge >= r.amount && r.level > nl2) nl2 = r.level; }
                                        if (nl2 > (ud2.member_level || 0)) await db.prepare('UPDATE users SET member_level=? WHERE id=?').bind(nl2, order.user_id).run();
                                    }
                                }
                            }
                        } catch(e) {}
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
                    await db.prepare('UPDATE users SET total_recharge = total_recharge + ? WHERE id=?').bind(rechargeAmount, paidOrder.user_id).run();
                    await db.prepare('INSERT INTO balance_transactions (user_id, amount, type, description, order_id, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(paidOrder.user_id, rechargeAmount, 'recharge', '充值' + rechargeAmount + '元', out_trade_no, time()).run();
                    try {
                        const enRow3 = await db.prepare("SELECT value FROM site_config WHERE key='member_enabled'").first();
                        if (enRow3 && enRow3.value === '1') {
                            const rlRow3 = await db.prepare("SELECT value FROM site_config WHERE key='member_upgrade_rules'").first();
                            if (rlRow3 && rlRow3.value) {
                                const rules3 = JSON.parse(rlRow3.value);
                                const ud3 = await db.prepare('SELECT total_recharge, member_level FROM users WHERE id=?').bind(paidOrder.user_id).first();
                                if (ud3 && rules3.length > 0) {
                                    let nl3 = ud3.member_level || 0;
                                    for (const r of rules3) { if (ud3.total_recharge >= r.amount && r.level > nl3) nl3 = r.level; }
                                    if (nl3 > (ud3.member_level || 0)) await db.prepare('UPDATE users SET member_level=? WHERE id=?').bind(nl3, paidOrder.user_id).run();
                                }
                            }
                        }
                    } catch(e) {}
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
