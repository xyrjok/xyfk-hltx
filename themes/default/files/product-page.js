/**
 * themes/default/files/product-page.js
 * 商品详情页专属逻辑 (修复版：完美支持批发价显示 + 二维码分享 + 蓝色风格)
 */

let currentProduct = null;
let currentVariant = null;
let quantity = 1;
let buyMethod = null;        // 'random' | 'select' | null
let paymentMethod = '';
let selectedSpecificCardId = null;
let selectedSpecificCardInfo = '';

$(document).ready(function() {
    loadProductDetail();

    $.ajax({
        url: '/api/shop/config',
        method: 'GET',
        success: function(config) {
            const siteName = (config && config.site_name) || '';
            window.globalSiteName = siteName; 
            const siteLogo = (config && config.site_logo) || '';
            const showName = (config && config.show_site_name);
            if (typeof renderHeader === 'function') renderHeader(siteName, siteLogo, showName);
            if (typeof renderFooter === 'function') renderFooter(siteName);
        },
        error: function() {
            if (typeof renderHeader === 'function') renderHeader();
            if (typeof renderFooter === 'function') renderFooter();
        }
    });
});

// 获取 URL 参数
function getQueryParam(name) {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get(name);
}

// 加载商品详情
function loadProductDetail() {
    const id = getQueryParam('id');
    if (!id) {
        alert('未指定商品ID');
        window.location.href = '/';
        return;
    }

    $('#detail-left-content').html('<div class="p-5 text-center text-muted">正在加载商品说明...</div>');
    $('#detail-right-content').html('<div class="p-5 text-center text-muted">加载信息...</div>');

    $.ajax({
        url: `/api/shop/product?id=${id}`,
        method: 'GET',
        success: function(res) {
            if (!res || res.error) {
                const msg = res.error || '商品不存在或已下架';
                alert(msg);
                window.location.href = '/';
                return;
            }
            // 缺货规格自动移动到所有规格的最后面
            if (res.variants && Array.isArray(res.variants)) {
                res.variants.sort((a, b) => {
                    const stockA = parseInt(a.stock) || 0;
                    const stockB = parseInt(b.stock) || 0;
                    if (stockA <= 0 && stockB > 0) return 1;
                    if (stockA > 0 && stockB <= 0) return -1;
                    return 0;
                });
            }
            currentProduct = res;
            if (res.name) {
                document.title = res.name;
            }
            renderProductPage(res);
        },
        error: function() {
            alert('网络错误，无法加载商品');
            window.location.href = '/';
        }
    });
}

// 渲染页面主逻辑
function renderProductPage(product) {
    // 1. 左侧：仅描述
    const descContent = product.description && product.description.trim() !== '' 
        ? product.description 
        : '<p class="text-muted text-center py-5">暂无详细说明</p>';

    const leftHtml = `
        <h5 class="fw-bold border-bottom pb-2 mb-3">商品详情</h5>
        <div class="product-description-content">
            ${descContent}
        </div>
    `;
    $('#detail-left-content').html(leftHtml);

    // 2. 右侧：功能区
    renderRightSidebar(product);
}

// 渲染右侧侧边栏
function renderRightSidebar(product) {
    // 初始状态
    currentVariant = null;
    let priceDisplay = '0.00';
    let totalStock = 0;

    if (product.variants && product.variants.length > 0) {
        totalStock = product.variants.reduce((sum, v) => sum + (parseInt(v.stock) || 0), 0);
        const prices = product.variants.map(v => parseFloat(v.price));
        const minPrice = Math.min(...prices);
        const maxPrice = Math.max(...prices);
        priceDisplay = minPrice !== maxPrice ? `${minPrice.toFixed(2)}-${maxPrice.toFixed(2)}` : minPrice.toFixed(2);
    }
    
    // 默认图片
    const displayImg = product.image_url || '/assets/noimage.jpg';

    // 标签 HTML
    const tagsHtml = renderTagsLocal(product.tags);

    // 规格按钮 HTML (初始不选中)
    const variantsHtml = renderSkuButtonsLocal(product.variants, -1);

    const rightHtml = `
        <style>
            .action-icon-wrap { position: relative; cursor: pointer; color: #6c757d; transition: color 0.2s; }
            .action-icon-wrap:hover { color: #1678ff; }
            .qr-popup {
                display: none;
                position: absolute;
                right: 0;
                top: 100%;
                margin-top: 8px;
                padding: 10px;
                background: #fff;
                border: 1px solid #ddd;
                box-shadow: 0 4px 12px rgba(0,0,0,0.1);
                border-radius: 4px;
                z-index: 100;
                width: 130px;
                text-align: center;
            }
            .action-icon-wrap:hover .qr-popup { display: block; }
        </style>

        <div class="img-aspect-ratio-box">
            <img src="${displayImg}" id="main-product-img" class="detail-product-img" alt="${product.name}">
        </div>

        <h1 class="product-page-title" id="product-title-el">${product.name}</h1>
        
        <div class="mb-2">${tagsHtml}</div>

        <div class="d-flex justify-content-between align-items-center mb-1" style="font-size: 13px;">
            <div class="text-muted">
                <span class="me-3">库存: <span id="p-stock">${totalStock}</span></span>
                <span>销量: ${product.variants.reduce((a,b)=>a+(b.sales_count||0), 0)}</span>
            </div>
            <div class="d-flex align-items-center">
                 <div class="action-icon-wrap me-3" title="手机扫码购买">
                    <i class="fas fa-qrcode fs-5"></i>
                    <div class="qr-popup">
                        <div id="sidebar-qrcode"></div>
                        <div style="font-size:10px; color:#999; margin-top:5px;">手机扫码下单</div>
                    </div>
                 </div>
                 <div class="action-icon-wrap" title="点击复制链接分享" onclick="shareTo('clipboard')">
                    <i class="fas fa-share-alt fs-5"></i>
                 </div>
            </div>
        </div>

        <div class="bg-light p-3 rounded mb-1">
            <div class="d-flex align-items-baseline" style="color: #1678ff;">
                <span class="fw-bold me-1" style="font-size: 16px;">¥</span>
                <span class="fw-bold" id="p-display-price" style="font-size: 24px; line-height: 1;">${priceDisplay}</span>
            </div>
            
            <div id="dynamic-info-display" class="mt-2 pt-2 border-top border-muted small" style="display:block; min-height:28px;">
                <span class="text-muted"><i class="fas fa-info-circle me-1"></i>请选择规格</span>
            </div>
        </div>

        <div class="mb-1">
            <div class="fw-bold mb-1 small text-muted">选择规格 <span class="fw-normal" style="font-size:12px">(共${product.variants.length}个)</span></div>
            <div class="d-flex flex-wrap" id="sku-btn-list" style="align-content: flex-start;">
                ${variantsHtml}
            </div>
            <div id="spec-pagination-area" class="spec-pagination-container"></div>
        </div>

        <div class="mb-2" id="buy-method-wrapper">
            <div class="fw-bold mb-1 small text-muted">购买方式</div>
            <div class="d-flex flex-wrap position-relative" id="buy-method-container">
                <span class="text-muted small py-1">请先选择规格</span>
            </div>
            <div id="number-selector-modal" class="number-selector-overlay">
                <div class="ns-header">
                    <span>请选择号码</span>
                    <span class="ns-close" onclick="closeNumberSelector()">×</span>
                </div>
                <div class="ns-body">
                    <div id="ns-list-container"></div>
                </div>
                <div class="ns-footer" onclick="closeNumberSelector()">
                    <i class="fas fa-chevron-up me-1"></i>收起列表
                </div>
            </div>
        </div>

        <div class="mb-2">
            <div class="fw-bold mb-1 small text-muted">购买数量</div>
            <div class="input-group" style="width: 130px;">
                <button class="btn btn-outline-secondary btn-sm" type="button" onclick="changeQty(-1)">-</button>
                <input type="text" class="form-control form-control-sm text-center" id="buy-qty" value="1" onchange="manualChangeQty(this)">
                <button class="btn btn-outline-secondary btn-sm" type="button" onclick="changeQty(1)">+</button>
            </div>
        </div>

       <div class="mb-2">
            <div class="fw-bold mb-1 small text-muted">联系信息</div>
            <div class="d-flex w-100">
                <input type="text" class="form-control form-control-sm" style="width: calc(50% - 3px); margin-right: 3px;" id="p-contact" placeholder="Email/QQ (用于查单)">
                <input type="text" class="form-control form-control-sm" style="width: calc(50% - 3px); margin-left: 3px;" id="p-password" placeholder="设置查单密码">
            </div>
        </div>

        <div class="mb-4">
            <div class="fw-bold mb-2 small text-muted">支付方式</div>
            <div class="d-flex flex-wrap" id="payment-method-list">
                </div>
        </div>

        <div class="d-flex align-items-center">
            <a href="/cart" class="text-secondary position-relative me-3 text-decoration-none" title="前往购物车" style="font-size: 22px;">
                <i class="far fa-shopping-cart"></i>
                <span class="common-cart-badge" id="product-page-cart-badge" style="top: -6px; right: -8px; display: none;">0</span>
            </a>
            
            <button class="btn btn-warning text-white flex-grow-1 fw-bold shadow-sm me-2" onclick="addToCart()">
                <i class="fas fa-cart-plus me-1"></i> 加购物车
            </button>
            <button class="btn btn-primary flex-grow-1 fw-bold shadow-sm" onclick="buyNow()">
                立即购买
            </button>
        </div>
    `;
    
    $('#detail-right-content').html(rightHtml);
    initStickySidebar();
    initPageQrcode();
    loadPaymentGateways();

    // 回显缓存信息
    const cachedContact = localStorage.getItem('userContact');
    const cachedPass = localStorage.getItem('userPassword');
    if(cachedContact) $('#p-contact').val(cachedContact);
    if(cachedPass) $('#p-password').val(cachedPass);

    setTimeout(() => {
        initSpecPagination('#sku-btn-list', '.variant-btn', 6);
    }, 50);
}

// =============================================
// === 工具函数：二维码与分享
// =============================================
function initPageQrcode() {
    const el = document.getElementById('sidebar-qrcode');
    if (el && typeof QRCode !== 'undefined') {
        el.innerHTML = '';
        new QRCode(el, {
            text: window.location.href,
            width: 100,
            height: 100,
            colorDark : "#000000",
            colorLight : "#ffffff",
            correctLevel : QRCode.CorrectLevel.L
        });
    }
    // 更新详情页购物车角标
    if (typeof window.updateCartBadge === 'function') window.updateCartBadge();
}

window.shareTo = function(platform) {
    const url = window.location.href;
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(url).then(() => {
            alert('商品链接已复制，赶快分享给好友吧！');
        }).catch(err => fallbackCopy(url));
    } else {
        fallbackCopy(url);
    }
};

function fallbackCopy(text) {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";
    textArea.style.left = "-9999px";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
        const successful = document.execCommand('copy');
        if (successful) alert('商品链接已复制，赶快分享给好友吧！');
        else alert('复制失败，请手动复制浏览器地址栏。');
    } catch (err) {
        alert('复制失败，请手动复制浏览器地址栏。');
    }
    document.body.removeChild(textArea);
}

// =============================================
// === 规格分页
// =============================================
function initSpecPagination(containerSelector, itemSelector, rowsPerPage = 6) {
    const container = document.querySelector(containerSelector);
    const paginationArea = document.getElementById('spec-pagination-area');
    if (!container || !paginationArea) return;

    let items = Array.from(container.querySelectorAll(itemSelector));
    if (items.length === 0) return;
    let currentPage = 1;
    let totalPages = 1;
    
    function calculatePages() {
        items.forEach(item => item.style.display = '');
        let rows = [];
        let lastTop = -1;
        let currentRow = [];
        
        items.forEach(item => {
            let currentTop = item.offsetTop;
            if (lastTop !== -1 && Math.abs(currentTop - lastTop) > 5) {
                rows.push(currentRow);
                currentRow = [];
            }
            currentRow.push(item);
            lastTop = currentTop;
        });
        if (currentRow.length > 0) rows.push(currentRow);

        totalPages = Math.ceil(rows.length / rowsPerPage);
        
        if (totalPages <= 1) {
            paginationArea.style.display = 'none';
            items.forEach(item => item.style.display = ''); 
            return;
        }

        paginationArea.style.display = 'block';
        renderPage(rows);
        renderControls(rows);
    }

    function renderPage(rows) {
        const startRow = (currentPage - 1) * rowsPerPage;
        const endRow = startRow + rowsPerPage;
        rows.forEach((row, index) => {
            const shouldShow = index >= startRow && index < endRow;
            row.forEach(item => { item.style.display = shouldShow ? '' : 'none'; });
        });
    }

    function renderControls(rows) {
        let html = '';
        html += `<span class="spec-pagination-btn ${currentPage === 1 ? 'disabled' : ''}" onclick="goToSpecPage(1)">首页</span>`;
        html += `<span class="spec-pagination-btn ${currentPage === 1 ? 'disabled' : ''}" onclick="goToSpecPage(${currentPage - 1})">上一页</span>`;
        html += `<span style="margin:0 6px; color:#999; font-size:12px;">${currentPage} / ${totalPages}</span>`;
        html += `<span class="spec-pagination-btn ${currentPage === totalPages ? 'disabled' : ''}" onclick="goToSpecPage(${currentPage + 1})">下一页</span>`;
        html += `<span class="spec-pagination-btn ${currentPage === totalPages ? 'disabled' : ''}" onclick="goToSpecPage(${totalPages})">尾页</span>`;
        
        paginationArea.innerHTML = html;
        window.goToSpecPage = function(page) {
            if (page >= 1 && page <= totalPages) {
                currentPage = page;
                renderPage(rows);
                renderControls(rows);
            }
        };
    }

    calculatePages();
    let resizeTimer;
    window.addEventListener('resize', () => { 
        clearTimeout(resizeTimer); 
        resizeTimer = setTimeout(calculatePages, 300); 
    });
}

// =============================================
// === 核心逻辑
// =============================================

window.selectSku = function(index, btn) {
    if (!currentProduct) return;

    if (currentVariant && currentVariant.id === currentProduct.variants[index].id) {
        currentVariant = null;
        buyMethod = null;
        selectedSpecificCardId = null;
        selectedSpecificCardInfo = '';
        closeNumberSelector();

        $('.variant-btn').removeClass('active');
        $('#main-product-img').attr('src', currentProduct.image_url || '/assets/noimage.jpg');
        const totalStock = currentProduct.variants.reduce((sum, v) => sum + (parseInt(v.stock) || 0), 0);
        $('#p-stock').text(totalStock);

        updateBuyMethodButtons();
        updateDynamicInfoDisplay();
        updateRealTimePrice();
        return;
    }
    
    $('.variant-btn').removeClass('active');
    $(btn).addClass('active');

    const variant = currentProduct.variants[index];
    currentVariant = variant;
    
    const imgUrl = variant.image_url || currentProduct.image_url || '/assets/noimage.jpg';
    $('#main-product-img').attr('src', imgUrl);
    $('#p-stock').text(variant.stock);

    buyMethod = null;
    selectedSpecificCardId = null;
    selectedSpecificCardInfo = '';
    closeNumberSelector();

    updateBuyMethodButtons();
    updateDynamicInfoDisplay();
    updateRealTimePrice();
};

function updateBuyMethodButtons() {
    const container = $('#buy-method-container');
    if (!currentVariant) {
        container.html('<span class="text-muted small py-1">请先选择规格</span>');
        return;
    }

    const markup = parseFloat(currentVariant.custom_markup || 0);
    const showSelect = markup > 0;
    let label = currentVariant.selection_label || '自选卡密/号码';

    if (buyMethod === 'select' && !showSelect) buyMethod = null;

    let html = '';
    const randomClass = buyMethod === 'random' ? 'active-method' : '';
    let randomLabel = currentVariant.random_mode_text || '默认随机';
    html += `<button class="btn btn-outline-secondary btn-sm me-2 mb-1 method-btn ${randomClass}" onclick="selectBuyMethod('random', this)">${randomLabel}</button>`;

    if (showSelect) {
        const selectClass = buyMethod === 'select' ? 'active-method' : '';
        html += `<button class="btn btn-outline-secondary btn-sm mb-1 method-btn ${selectClass}" onclick="selectBuyMethod('select', this)">${label} (加价${markup.toFixed(2)}元)</button>`;
    }
    container.html(html);
}

window.selectBuyMethod = function(type, btn) {
    if (buyMethod === type) {
        buyMethod = null; 
        closeNumberSelector();
    } else {
        buyMethod = type;
        if (type === 'select') {
            openNumberSelector(); 
        } else {
            selectedSpecificCardId = null;
            selectedSpecificCardInfo = '';
            closeNumberSelector();
        }
    }
    
    updateBuyMethodButtons(); 
    updateDynamicInfoDisplay(); 
    updateRealTimePrice();
};

function updateRealTimePrice() {
    const priceEl = $('#p-display-price');
    if (priceEl.length === 0) return;

    if (!currentVariant) {
        if (currentProduct && currentProduct.variants) {
            const prices = currentProduct.variants.map(v => parseFloat(v.price));
            if(prices.length > 0) {
                const min = Math.min(...prices);
                const max = Math.max(...prices);
                priceEl.text(min !== max ? `${min.toFixed(2)}-${max.toFixed(2)}` : min.toFixed(2));
            } else {
                priceEl.text('0.00');
            }
        }
        return;
    }

    let finalPrice = parseFloat(currentVariant.price);
    let displayHTML = finalPrice.toFixed(2);

    if (buyMethod === 'random') {
        const rules = parseWholesaleDataForCalc(currentVariant.wholesale_config);
        if (rules.length > 0) {
            const rule = rules.find(r => quantity >= r.count);
            if (rule) {
                finalPrice = parseFloat(rule.price);
                displayHTML = finalPrice.toFixed(2);
            }
        }
    }
    else if (buyMethod === 'select') {
        const markup = parseFloat(currentVariant.custom_markup || 0);
        if (markup > 0) {
            const basePrice = finalPrice; 
            const totalPrice = basePrice + markup;
            displayHTML = `<span style="font-size:0.6em; color:#999; vertical-align: middle;">${basePrice.toFixed(2)} + ${markup.toFixed(2)} = </span>${totalPrice.toFixed(2)}`;
        }
        
        if (quantity > 1) {
             quantity = 1;
             $('#buy-qty').val(1);
        }
    }

    priceEl.html(displayHTML);
}

// 动态信息显示 (修正了批发价解析)
function updateDynamicInfoDisplay() {
    const displayDiv = $('#dynamic-info-display');
    
    if (!currentVariant || buyMethod === null) {
        displayDiv.html('<span class="text-muted"><i class="fas fa-info-circle me-1"></i>请选择规格和购买方式</span>');
        return;
    }

    const specName = currentVariant.name || currentVariant.specs || '默认规格';
    let leftHtml = '';
    const activeColor = '#1678ff'; // 蓝色风格
    const activeStyle = `color:${activeColor}; font-weight:500; font-size:13px;`;
    
    if (buyMethod === 'random') {
        // 使用增强版解析函数
        const promoText = parseWholesaleInfo(currentVariant.wholesale_config);
        if (promoText) {
            leftHtml = `<span style="${activeStyle}"><i class="fas fa-tags me-1"></i>批发优惠: ${promoText}</span>`;
        } else {
            let randomLabel = currentVariant.random_mode_text || '默认随机';
            leftHtml = `<span style="${activeStyle}">${randomLabel}</span>`;
        }
    } else if (buyMethod === 'select') {
        const markup = parseFloat(currentVariant.custom_markup || 0).toFixed(2);
        let label = currentVariant.selection_label || '自选';
        leftHtml = `<span style="${activeStyle}">${label} (加价 ${markup}元)</span>`;
    }

    let rightInfo = specName;
    if (buyMethod === 'select' && selectedSpecificCardInfo) {
        rightInfo += ` + ${selectedSpecificCardInfo}`;
    }

    displayDiv.html(`<span style="${activeStyle} margin-right:8px;"><i class="fa fa-check-circle me-1"></i>已选: ${rightInfo}</span> ${leftHtml}`);
}

// 选号弹窗
window.openNumberSelector = async function() {
    const modal = $('#number-selector-modal');
    const listContainer = $('#ns-list-container');
    
    modal.css('display', 'flex').hide().slideDown(200);
    listContainer.html('<div class="text-center w-100 mt-3"><i class="fas fa-spinner fa-spin"></i> 加载中...</div>');

    try {
        const res = await fetch(`/api/shop/cards/notes?variant_id=${currentVariant.id}`);
        const data = await res.json();

        if (Array.isArray(data) && data.length > 0) {
            let html = '';
            data.forEach(item => {
                const isSelected = selectedSpecificCardId === item.id ? 'selected' : '';
                html += `<div class="ns-item ${isSelected}" onclick="selectNumberItem(${item.id}, '${item.note}', this)">${item.note}</div>`;
            });
            listContainer.html(html);
        } else {
            listContainer.html('<div class="text-center w-100 mt-3 text-muted">暂无可自选号码</div>');
        }
    } catch (e) {
        console.error(e);
        listContainer.html('<div class="text-center w-100 mt-3 text-danger">加载失败</div>');
    }
};

window.closeNumberSelector = function() {
    $('#number-selector-modal').slideUp(200);
};

window.selectNumberItem = function(id, note, el) {
    selectedSpecificCardId = id;
    selectedSpecificCardInfo = note;
    $('.ns-item').removeClass('selected');
    $(el).addClass('selected');
    updateDynamicInfoDisplay();
    updateRealTimePrice();
    setTimeout(closeNumberSelector, 200);
};

// 数量变更
window.changeQty = function(delta) {
    let newQty = quantity + delta;
    if (newQty < 1) newQty = 1;
    updateQty(newQty);
};

window.manualChangeQty = function(el) {
    let val = parseInt(el.value);
    if (isNaN(val) || val < 1) val = 1;
    updateQty(val);
};

function updateQty(val) {
    if (buyMethod === 'select') {
        if (val > 1) alert('自选模式下每次只能购买 1 个');
        val = 1;
    } else if (currentVariant) {
        if (currentVariant.stock !== '充足' && val > currentVariant.stock) {
            alert(`库存不足，当前仅剩 ${currentVariant.stock} 件`);
            val = currentVariant.stock;
        }
    }
    quantity = val;
    $('#buy-qty').val(quantity);
    updateRealTimePrice();
}

window.selectPayment = function(type, el) {
    paymentMethod = type;
    $('.payment-option').removeClass('active');
    $(el).addClass('active');
};

// 加入购物车
window.addToCart = function() {
    if (!validateBuy()) return;
    saveContactInfo();

    let cart = JSON.parse(localStorage.getItem('tbShopCart') || '[]');
    let existingItem = null;
    if (buyMethod === 'random') {
        existingItem = cart.find(item => item.variant_id === currentVariant.id && item.buyMode === 'random');
    } 

    if (existingItem) {
        existingItem.quantity += quantity;
    } else {
        cart.push({
            product_id: currentProduct.id,
            variant_id: currentVariant.id,
            name: currentProduct.name,
            variant_name: currentVariant.name || currentVariant.specs,
            price: currentVariant.price,
            image: currentVariant.image_url || currentProduct.image_url,
            quantity: quantity,
            buyMode: buyMethod,
            selectedCardId: selectedSpecificCardId,
            selectedCardInfo: selectedSpecificCardInfo 
        });
    }

    localStorage.setItem('tbShopCart', JSON.stringify(cart));
    const btn = $(event.target).closest('button');
    const originalText = btn.html();
    btn.html('<i class="fas fa-check"></i> 已加入').addClass('btn-success').removeClass('btn-warning');
    
    // 更新角标
    if (typeof window.updateCartBadge === 'function') {
        window.updateCartBadge();
    }

    setTimeout(() => {
        btn.html(originalText).removeClass('btn-success').addClass('btn-warning');
    }, 1500);
};

// 立即购买
window.buyNow = async function() {
    if (!validateBuy()) return;
    saveContactInfo();

    const contact = $('#p-contact').val().trim();
    const password = $('#p-password').val().trim();
    const btn = $(event.target).closest('button');
    const originalContent = btn.html();

    btn.prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> 下单中...');

    const payload = {
        variant_id: currentVariant.id,
        quantity: quantity,
        contact: contact,
        query_password: password,
        payment_method: paymentMethod, 
        card_id: (buyMethod === 'select') ? selectedSpecificCardId : null
    };

    try {
        const res = await fetch('/api/shop/order/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        
        if (data.error) {
            if (data.error.includes('未支付订单') && confirm('提示：' + data.error + '\n\n点击“确定”前往查单页面处理。')) {
                window.location.href = '/orders';
            } else {
                alert(data.error);
            }
            btn.prop('disabled', false).html(originalContent);
        } else {
            window.location.href = `/pay?order_id=${data.order_id}&method=${paymentMethod}`;
        }
    } catch (e) {
        alert('请求失败，请检查网络');
        btn.prop('disabled', false).html(originalContent);
    }
};

function validateBuy() {
    if (!currentVariant) { alert('请先选择规格'); return false; }
    if (currentVariant.stock <= 0) { alert('该规格缺货'); return false; }
    if (buyMethod === null) { alert('请选择购买方式'); return false; }
    if (buyMethod === 'select' && !selectedSpecificCardId) {
        alert('请选择一个号码/卡密');
        openNumberSelector(); 
        return false;
    }
    const contact = $('#p-contact').val().trim();
    const password = $('#p-password').val().trim();
    if (!contact) { alert('请输入联系方式'); $('#p-contact').focus(); return false; }
    if (!password) { alert('请设置查单密码'); $('#p-password').focus(); return false; }
    return true;
}

function saveContactInfo() {
    const c = $('#p-contact').val().trim();
    const p = $('#p-password').val().trim();
    if(c) localStorage.setItem('userContact', c);
    if(p) localStorage.setItem('userPassword', p);
}

// 规格按钮渲染
function renderSkuButtonsLocal(variants, selectedIdx) {
    if (!variants || variants.length === 0) return '<span class="text-muted small">默认规格</span>';
    
    return variants.map((v, index) => {
        const isOOS = v.stock <= 0;
        const priceStr = parseFloat(v.price).toFixed(2);
        const name = v.name || v.specs || `规格${index+1}`;
        let btnClass = isOOS ? 'no-stock' : '';
        const badgeHtml = isOOS ? '<span class="sku-oos-badge">缺货</span>' : '';
        
        return `<button class="variant-btn ${btnClass}" onclick="${isOOS ? '' : `selectSku(${index}, this)`}" ${isOOS ? 'disabled' : ''}>
                    ${name} (￥${priceStr})
                    ${badgeHtml}
                </button>`;
    }).join('');
}

function renderTagsLocal(tags) {
    if (!tags) return '';
    const tagsArr = tags.split(/[,，]+/).filter(t => t && t.trim());
    return tagsArr.map(tagStr => {
        tagStr = tagStr.trim();
        let borderColor = '#dc3545', bgColor = '#dc3545', textColor = '#fff', labelText = tagStr;
        if (tagStr.includes(' ') && (tagStr.includes('b1#') || tagStr.includes('b2#'))) {
            const parts = tagStr.split(/\s+/);
            parts.forEach(part => {
                if (part.startsWith('b1#')) borderColor = part.replace('b1#', '#');
                else if (part.startsWith('b2#')) bgColor = part.replace('b2#', '#');
                else if (part.includes('#')) {
                    const txtParts = part.split('#');
                    labelText = txtParts[0];
                    if (txtParts[1]) textColor = '#' + txtParts[1];
                } else { labelText = part; }
            });
        }
        return `<span class="badge-tag" style="background-color:${bgColor};border-color:${borderColor};color:${textColor}">${labelText}</span>`;
    }).join('');
}

// =============================================
// === 批发价解析逻辑 (修复：支持 Object/String/JSON 等多种格式) ===
// =============================================
function parseWholesaleDataForCalc(config) {
    let rules = [];
    if (!config) return rules;
    let data = config;
    if (typeof data === 'string') {
        try { 
            if (data.startsWith('[') || data.startsWith('{')) { data = JSON.parse(data); } 
            else {
                data.split(/[,，]/).forEach(p => {
                    const [k, v] = p.split('=');
                    if(k && v) rules.push({ count: parseInt(k), price: parseFloat(v) });
                });
                return rules.sort((a,b) => b.count - a.count);
            }
        } catch(e) { return []; }
    }
    if (Array.isArray(data)) {
         data.forEach(item => {
             const c = item.count || item.num || item.qty || item.n;
             const p = item.price || item.amount || item.p;
             if(c && p) rules.push({ count: parseInt(c), price: parseFloat(p) });
         });
    } else if (typeof data === 'object') {
        Object.entries(data).forEach(([k,v]) => { rules.push({ count: parseInt(k), price: parseFloat(v) }); });
    }
    return rules.sort((a,b) => b.count - a.count);
}

// 核心修复函数
function parseWholesaleInfo(config) {
    if (!config) return null;
    let rules = [];
    let data = config;
    
    // 1. 尝试解析字符串（JSON或逗号分隔）
    if (typeof data === 'string') {
        data = data.trim();
        if (data.startsWith('[') || data.startsWith('{')) {
            try { data = JSON.parse(data); } catch (e) { /* 解析失败则忽略 */ }
        } else {
            // 尝试解析 5=3,10=2.5 这种简写格式
            data.split(/[,，]/).forEach(p => {
                const [k, v] = p.split('=');
                if (k && v) rules.push(`${k}个起${v}元/个`);
            });
            // 如果成功解析出简写规则，直接返回
            if (rules.length > 0) return rules.join('，');
        }
    }

    // 2. 解析 Array 格式
    if (Array.isArray(data)) {
        data.forEach(item => {
            const n = item.num || item.number || item.count || item.qty || item.n;
            const p = item.price || item.money || item.amount || item.p;
            if (n && p) rules.push(`${n}个起${p}元/个`);
        });
    } 
    // 3. 解析 Object 格式 (例如 {"5": 3, "10": 2.5})
    else if (typeof data === 'object' && data !== null) {
        Object.entries(data).forEach(([k, v]) => { 
            if(!isNaN(k)) rules.push(`${k}个起${v}元/个`); 
        });
    }
    
    return rules.length > 0 ? rules.join('，') : null;
}

let sidebar = null;
function initStickySidebar() {
    if (typeof StickySidebar === 'undefined') return;
    const options = {
        topSpacing: 50,
        bottomSpacing: 0,
        containerSelector: '.product-detail-grid',
        innerWrapperSelector: '.sidebar-inner'
    };
    const checkSidebar = () => {
        const isMobile = window.innerWidth < 992;
        const leftHeight = $('.detail-left').outerHeight();
        const rightHeight = $('.sidebar-inner').outerHeight();
        if (isMobile || leftHeight <= rightHeight) {
            if (sidebar) { sidebar.destroy(); sidebar = null; }
        } else {
            if (!sidebar) { sidebar = new StickySidebar('#sidebar-wrapper', options); } 
            else { sidebar.updateSticky(); }
        }
    };
    setTimeout(checkSidebar, 500);
    window.addEventListener('resize', checkSidebar);
}
function loadPaymentGateways() {
    $.ajax({
        url: '/api/shop/gateways',
        method: 'GET',
        success: function(list) {
            const container = $('#payment-method-list');
            if (!list || list.length === 0) { container.html('<small class="text-muted">暂无</small>'); return; }
            let html = '';
            // 变更点1：默认选中第一个的 ID 作为支付标志
            paymentMethod = list[0].id;
            list.forEach((g, index) => {
                const activeClass = index === 0 ? 'active' : '';
                let iconHtml = '<i class="fas fa-credit-card"></i>';
                
                // 变更点2：如果后台配置了图标，则优先使用后台图标图片
                if (g.icon) {
                    iconHtml = `<img src="${g.icon}" style="width:20px; height:20px; object-fit:contain;"> <span style="font-size:13px; font-weight:bold; margin-left:4px;">${g.name}</span>`;
                } else {
                    iconHtml = `<i class="fas fa-credit-card" style="color:#1678ff;"></i> <span style="font-size:13px; font-weight:bold; margin-left:4px;">${g.name}</span>`;
                }
                
                // 变更点3：将对应的网关 ID 传入选择事件
                html += `<div class="payment-option ${activeClass}" onclick="selectPayment('${g.id}', this)" title="${g.name}">${iconHtml}<div class="payment-check-mark"><i class="fas fa-check"></i></div></div>`;
            });
            container.html(html);
        }
    });
}
