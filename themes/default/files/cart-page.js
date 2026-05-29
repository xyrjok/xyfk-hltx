// =============================================
// === themes/default/files/cart-page.js
// === (Default主题适配版：各种功能与TBshop一致，UI风格适配Default)
// =============================================

let cart = [];
let isEditing = false;
let cartPaymentMethod = '';

/**
 * 页面加载初始化
 */
document.addEventListener('DOMContentLoaded', async () => {
    // 1. 加载配置 (可选，若header.js已处理可忽略，但为了稳健保留)
    try {
        // 如果有需要预加载的配置，可以在此处理
    } catch (e) { console.error('Config load error', e); }

    // 2. 加载购物车数据
    loadCart();

    // 3. 恢复本地缓存的联系人信息
    const cachedContact = localStorage.getItem('userContact');
    const cachedPass = localStorage.getItem('userPassword');
    
    if (cachedContact) {
        const inputs = [document.getElementById('contact-info'), document.getElementById('contact-info-mobile')];
        inputs.forEach(el => { if(el) el.value = cachedContact; });
    }
    if (cachedPass) {
        const inputs = [document.getElementById('query-password'), document.getElementById('query-password-mobile')];
        inputs.forEach(el => { if(el) el.value = cachedPass; });
    }

    // 4. 监听输入框同步 (PC端和移动端输入框值保持一致)
    syncInputs('contact-info', 'contact-info-mobile');
    syncInputs('query-password', 'query-password-mobile');
    loadCartGateways();
});

// 5. 新增：等页面和图片完全加载后再初始化侧边栏吸附 (仅在PC端有效)
window.addEventListener('load', function() {
    if (window.innerWidth > 991 && typeof StickySidebar !== 'undefined') {
        new StickySidebar('#sidebar-wrapper', {
            topSpacing: 80,
            bottomSpacing: 20,
            containerSelector: '.product-detail-grid',
            innerWrapperSelector: '.sidebar-inner'
        });
    }
});

/**
 * 同步两个输入框的值
 */
function syncInputs(id1, id2) {
    const el1 = document.getElementById(id1);
    const el2 = document.getElementById(id2);
    if(el1 && el2) {
        el1.addEventListener('input', e => el2.value = e.target.value);
        el2.addEventListener('input', e => el1.value = e.target.value);
    }
}

/**
 * 标准化商品数据对象，确保字段齐全
 */
function normalizeItem(item) {
    return {
        productId: item.product_id || item.productId || item.product_id, 
        variantId: item.variant_id || item.variantId, 
        
        name: item.productName || item.name || item.title || '未命名商品',
        // 如果没有图片，使用base64占位图或默认图
        img: item.img || item.image || item.thumb || item.pic || 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI1MCIgaGVpZ2h0PSI1MCI+PHJlY3Qgd2lkdGg9IjUwIiBoZWlnaHQ9IjUwIiBmaWxsPSIjZWVlIi8+PC9zdmc+',
        
        sku: item.variant_name || item.variantName || item.skuName || item.variant || '默认规格',
        
        price: parseFloat(item.price || 0),
        quantity: parseInt(item.quantity || 1),
        buyMode: item.buyMode || 'auto', // auto:自动发货, select:自选, random:随机
        
        inputData: item.selectedCardInfo || item.selectedCardNote || item.input_data || item.customInfo || '',
        
        checked: item.checked !== false
    };
}

/**
 * 切换支付方式
 */
function selectCartPayment(method, el) {
    cartPaymentMethod = method;
    const containers = ['cart-payment-list-pc', 'cart-payment-list-mobile'];
    
    containers.forEach(id => {
        const container = document.getElementById(id);
        if (!container) return;
        
        // 移除所有 active
        const options = container.querySelectorAll('.payment-option');
        options.forEach(opt => opt.classList.remove('active'));
        
        // 激活对应 method 的选项
        const target = container.querySelector(`.payment-option[data-method="${method}"]`);
        if (target) target.classList.add('active');
    });
}

/**
 * 加载购物车并渲染界面
 */
function loadCart() {
    try {
        cart = JSON.parse(localStorage.getItem('tbShopCart') || '[]');
    } catch (e) {
        cart = [];
    }
    
    const listMobile = document.getElementById('cart-list-mobile');
    const listPC = document.getElementById('cart-list-pc');
    
    // 空状态 HTML
    const emptyHtmlMobile = `
        <div class="text-center p-5 text-muted">
            <i class="fa fa-shopping-basket fa-2x mb-3 text-black-50" style="opacity:0.2"></i>
            <p>购物车空空如也</p>
            <a href="/" class="btn btn-sm btn-outline-secondary">去逛逛</a>
        </div>`;
    const emptyHtmlPC = '<tr><td colspan="6" class="text-center p-5 text-muted">购物车空空如也，<a href="/">去选购</a></td></tr>';
    
    if (cart.length === 0) {
        if(listMobile) listMobile.innerHTML = emptyHtmlMobile;
        if(listPC) listPC.innerHTML = emptyHtmlPC;
    } else {
        if(listMobile) listMobile.innerHTML = cart.map((item, index) => renderMobileItem(item, index)).join('');
        if(listPC) listPC.innerHTML = cart.map((item, index) => renderPCItem(item, index)).join('');
    }

    // 更新各处金额和数量
    updateTotal();
}

/**
 * [渲染] PC端 列表项 (TableRow)
 * 适配 cart.html 的 Table 结构
 */
function renderPCItem(rawItem, index) {
    const item = normalizeItem(rawItem);
    const subtotal = (item.price * item.quantity).toFixed(2);
    const productLink = item.productId ? `product?id=${item.productId}` : 'javascript:void(0)';
    
    // 附加信息显示 (自选号码/随机/自动)
    let extraInfo = '';
    if (item.buyMode === 'select') {
        extraInfo = item.inputData ? 
            `<div class="text-primary small mt-1" style="font-size:12px;"><i class="fa fa-check-circle me-1"></i>已选: ${item.inputData}</div>` : 
            `<div class="text-danger small mt-1" style="font-size:12px;">未选号码</div>`;
    } else if (item.buyMode === 'random') {
        extraInfo = `<div class="text-muted small mt-1" style="font-size:12px;">[随机发货]</div>`;
    }
    
    return `
    <tr>
        <td class="ps-2">
            <input class="form-check-input" type="checkbox" onchange="toggleItemCheck(${index}, this)" ${item.checked ? 'checked' : ''} style="cursor:pointer;">
        </td>
        <td>
            <div class="d-flex align-items-start">
                <a href="${productLink}" target="_blank" class="d-block me-2 flex-shrink-0">
                    <img src="${item.img}" alt="img" 
                         onerror="this.src='data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCI+PHJlY3Qgd2lkdGg9IjQwIiBoZWlnaHQ9IjQwIiBmaWxsPSIjZWVlIi8+PC9zdmc+'" 
                         style="width:48px;height:48px;object-fit:cover;border-radius:4px;border:1px solid #eee;">
                </a>
                <div style="min-width:0;">
                    <a href="${productLink}" target="_blank" class="text-dark text-decoration-none d-block fw-bold text-truncate" style="font-size:13px; max-width: 220px;">
                        ${item.name}
                    </a>
                    <div class="small text-muted" style="font-size:12px;">
                        ${item.sku}
                    </div>
                    ${extraInfo}
                </div>
            </div>
        </td>
        <td class="text-muted" style="font-size:13px;">¥${item.price.toFixed(2)}</td>
        <td>
            <div class="stepper">
                <button type="button" class="stepper-btn minus" onclick="changeQty(${index}, -1)">-</button>
                <input type="number" class="stepper-input" value="${item.quantity}" onchange="changeQty(${index}, 0, this.value)">
                <button type="button" class="stepper-btn plus" onclick="changeQty(${index}, 1)">+</button>
            </div>
        </td>
        <td><strong class="text-danger" style="font-size:13px;">¥${subtotal}</strong></td>
        <td>
            <a href="javascript:void(0)" class="text-secondary small p-2" onclick="deleteItem(${index})" title="删除">
                <i class="fa fa-trash-alt"></i>
            </a>
        </td>
    </tr>`;
}

/**
 * [渲染] 移动端 列表项 (Card)
 * 适配 Default 主题风格
 */
function renderMobileItem(rawItem, index) {
    const item = normalizeItem(rawItem);
    const productLink = item.productId ? `product?id=${item.productId}` : 'javascript:void(0)';

    let infoText = '';
    if (item.buyMode === 'select') {
        infoText = item.inputData ? `已选: ${item.inputData}` : '未选';
    } else if (item.buyMode === 'random') {
        infoText = '随机';
    } else {
        infoText = '自动';
    }
    
    return `
    <div class="cart-item-mobile bg-white p-3 mb-2 rounded position-relative shadow-sm" style="border:1px solid #f0f0f0;">
        <div class="d-flex">
            <div class="me-3 d-flex align-items-center">
                <input class="form-check-input" style="width:1.3em;height:1.3em;" type="checkbox" onchange="toggleItemCheck(${index}, this)" ${item.checked ? 'checked' : ''}>
            </div>
            
            <a href="${productLink}" class="d-block me-3 flex-shrink-0">
                <img src="${item.img}" class="rounded" alt="img" 
                     onerror="this.src='data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2MCIgaGVpZ2h0PSI2MCI+PHJlY3Qgd2lkdGg9IjYwIiBoZWlnaHQ9IjYwIiBmaWxsPSIjZWVlIi8+PC9zdmc+'"
                     style="width:70px; height:70px; object-fit:cover; border:1px solid #eee;">
            </a>

            <div class="flex-grow-1 overflow-hidden">
                <a href="${productLink}" class="text-truncate mb-1 text-dark text-decoration-none d-block fw-bold" style="font-size:14px;">
                    ${item.name}
                </a>
                <div class="d-flex align-items-center flex-wrap small text-muted mb-2" style="font-size:12px;">
                    <span class="bg-light text-dark border rounded px-1 me-1">${item.sku}</span>
                    <span class="text-truncate text-primary" style="max-width: 120px;">${infoText}</span>
                </div>
                
                <div class="d-flex justify-content-between align-items-center">
                    <div class="text-danger fw-bold fs-6">¥${item.price.toFixed(2)}</div>
                    
                    <div class="stepper" style="height:26px; width:86px;">
                        <button type="button" class="stepper-btn minus" onclick="changeQty(${index}, -1)" style="width:24px; font-size:12px;">-</button>
                        <input type="number" class="stepper-input" value="${item.quantity}" onchange="changeQty(${index}, 0, this.value)" style="width:38px; font-size:12px;">
                        <button type="button" class="stepper-btn plus" onclick="changeQty(${index}, 1)" style="width:24px; font-size:12px;">+</button>
                    </div>
                </div>
            </div>
        </div>
        
        <button class="btn btn-sm text-muted position-absolute top-0 end-0 mt-2 me-2" 
                onclick="deleteItem(${index})">
            <i class="fa fa-times"></i>
        </button>
    </div>`;
}

/**
 * 切换单个商品选中状态
 */
function toggleItemCheck(idx, el) {
    if(cart[idx]) {
        cart[idx].checked = el.checked;
        updateTotal();
    }
}

/**
 * 移动端管理按钮切换 (可选)
 */
function toggleEdit() {
    isEditing = !isEditing;
    const btn = document.getElementById('edit-btn-mobile');
    if(btn) btn.innerText = isEditing ? '完成' : '管理';
    // 这里的 loadCart 主要是为了重新渲染以显示某些在编辑模式下才出来的元素，
    // 但上面的 renderMobileItem 已经把删除按钮做成常驻或绝对定位了，所以这里仅作状态切换
    loadCart(); 
}

/**
 * 全选/全不选
 */
window.toggleCheckAll = function(source) {
    const checked = source.checked;
    cart.forEach(item => item.checked = checked);
    localStorage.setItem('tbShopCart', JSON.stringify(cart));
    loadCart(); 
}

/**
 * 计算总价并更新DOM
 */
function updateTotal() {
    let total = 0;
    let count = 0;
    
    const hasItems = cart.length > 0;
    let allChecked = hasItems; 

    cart.forEach(item => {
        if(item.checked !== false) { 
            const p = parseFloat(item.price) || 0;
            const q = parseInt(item.quantity) || 1;
            total += p * q;
            count++;
        } else {
            allChecked = false;
        }
    });
    
    // 更新全选框状态
    const checkAllIds = ['check-all-pc', 'check-all-mobile-top'];
    checkAllIds.forEach(id => {
        const el = document.getElementById(id);
        if(el) el.checked = (hasItems && allChecked);
    });

    // 更新价格和数量显示
    const ids = [
        { t: 'total-price-pc', c: 'checkout-count-pc' },
        { t: 'total-price-mobile', c: 'checkout-count-mobile' }
    ];
    
    ids.forEach(obj => {
        const tEl = document.getElementById(obj.t);
        const cEl = document.getElementById(obj.c);
        if(tEl) tEl.innerText = total.toFixed(2);
        if(cEl) cEl.innerText = count;
    });
    
    localStorage.setItem('tbShopCart', JSON.stringify(cart));
}

/**
 * 修改数量
 */
window.changeQty = function(idx, delta, absVal=null) {
    if(!cart[idx]) return;
    
    // [逻辑保留] 自选号码模式下，限制数量只能为1
    if (cart[idx].buyMode === 'select') {
        // 如果尝试增加数量，或者直接输入大于1的数值
        if ((delta > 0) || (absVal !== null && parseInt(absVal) > 1)) {
            alert('提示：该商品为加价自选，每组预设信息只能购买一份。\n如需购买多份，请返回商品页选择其他号码/预设信息。');
            if (absVal !== null) {
                // 如果是输入框输入，强制重置为1
                cart[idx].quantity = 1;
                localStorage.setItem('tbShopCart', JSON.stringify(cart));
                loadCart();
            }
            return;
        }
    }

    let q = parseInt(cart[idx].quantity) || 1;
    if(absVal !== null) {
        q = parseInt(absVal);
    } else {
        q += delta;
    }
    
    if(isNaN(q) || q < 1) q = 1;
    
    cart[idx].quantity = q;
    localStorage.setItem('tbShopCart', JSON.stringify(cart));
    loadCart(); 
}

/**
 * 删除商品
 */
window.deleteItem = function(idx) {
    if(confirm('确定删除该商品吗？')) {
        cart.splice(idx, 1);
        localStorage.setItem('tbShopCart', JSON.stringify(cart));
        loadCart();
    }
}

/**
 * 结算提交
 */
window.handleCheckout = async function() {
    const selected = cart.filter(i => i.checked !== false);
    if(selected.length === 0) return alert('请选择要结算的商品');
    
    const contact = document.getElementById('contact-info').value.trim() || document.getElementById('contact-info-mobile').value.trim();
    const pass = document.getElementById('query-password').value.trim() || document.getElementById('query-password-mobile').value.trim();
    
    if(!contact) return alert('请输入联系方式');
    if(!pass || pass.length < 1) return alert('请输入查单密码 (至少1位)');
    
    // 保存用户习惯
    localStorage.setItem('userContact', contact);
    localStorage.setItem('userPassword', pass);
    
    // 禁用按钮防抖
    const btns = document.querySelectorAll('button[onclick="handleCheckout()"]');
    btns.forEach(b => { b.disabled = true; b.innerText = '提交中...'; });
    
    try {
        const payload = {
            items: selected.map(normalizeItem), 
            contact: contact,
            query_password: pass,
            payment_method: cartPaymentMethod
        };
        
        const res = await fetch('/api/shop/cart/checkout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        
        if(data.error) {
            // [逻辑保留] 拦截未支付订单错误
            if (data.error.includes('未支付订单')) {
                if(confirm('提示：' + data.error + '\n\n点击"确定"前往查单页面处理。')) {
                    // Default主题通常查单页是 /orders
                    window.location.href = 'orders';
                    return;
                }
            }
            throw new Error(data.error);
        }
        
        // 结算成功，从购物车移除已结算商品
        const remaining = cart.filter(i => i.checked === false);
        localStorage.setItem('tbShopCart', JSON.stringify(remaining));
        
        // 跳转支付页 (使用 TBshop 提供的 pay 页面逻辑，通常路径通用)
        window.location.href = `pay?order_id=${data.order_id}&method=${cartPaymentMethod}`;
    } catch(e) {
        alert('结算失败: ' + e.message);
        btns.forEach(b => { b.disabled = false; b.innerText = '立即结算'; });
    }
}

async function loadCartGateways() {
    try {
        const res = await fetch('/api/shop/gateways');
        const list = await res.json();
        const containers = ['cart-payment-list-pc', 'cart-payment-list-mobile'];
        if (!list || list.length === 0) return;
        
        cartPaymentMethod = list[0].id; // 默认选中第一个
        const html = list.map((g, index) => {
            const activeClass = index === 0 ? 'active' : '';
            let iconHtml = '<i class="fas fa-credit-card"></i>';
            if (g.icon) {
                iconHtml = `<img src="${g.icon}" style="width:20px; height:20px; object-fit:contain;"> <span style="font-size:13px; font-weight:bold; margin-left:4px;">${g.name}</span>`;
            } else {
                iconHtml = `<i class="fas fa-credit-card" style="color:#1678ff;"></i> <span style="font-size:13px; font-weight:bold; margin-left:4px;">${g.name}</span>`;
            }
            return `<div class="payment-option ${activeClass}" data-method="${g.id}" onclick="selectCartPayment('${g.id}', this)" title="${g.name}">
                        ${iconHtml}<div class="payment-check-mark"><i class="fas fa-check"></i></div>
                    </div>`;
        }).join('');

        containers.forEach(id => { const el = document.getElementById(id); if(el) el.innerHTML = html; });
    } catch(e) {}
}
