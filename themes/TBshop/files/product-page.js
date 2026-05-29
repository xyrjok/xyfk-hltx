// =============================================
// === themes/TBshop/files/product-page.js
// === (修复版：拦截未支付订单跳转 + 推特分享 + 复制链接功能 + 移动端主图遮罩优化 + PC端保持原样)
// =============================================

// 全局变量
let currentProduct = null;   // 当前商品数据
let currentVariant = null;   // 当前选中的 SKU
let quantity = 1;            // 购买数量
let buyMethod = null;        // 购买方式: null | 'random' | 'select'
let paymentMethod = '';

// 自选号码相关全局变量
let selectedSpecificCardId = null;   // 选中的具体卡密ID
let selectedSpecificCardInfo = '';   // 选中的卡密预设信息 (#[...]的内容)

// 页面启动入口
async function initProductPage() {
    const urlParams = new URLSearchParams(window.location.search);
    const productId = urlParams.get('id');

    if (!productId) {
        showError('参数错误：未指定商品ID');
        return;
    }

    try {
        const res = await fetch(`/api/shop/product?id=${productId}`);
        const data = await res.json();

        if (data.error) {
            showError(data.error);
        } else {
            // 缺货规格自动移动到所有规格的最后面
            if (data.variants && Array.isArray(data.variants)) {
                data.variants.sort((a, b) => {
                    const stockA = parseInt(a.stock) || 0;
                    const stockB = parseInt(b.stock) || 0;
                    if (stockA <= 0 && stockB > 0) return 1;
                    if (stockA > 0 && stockB <= 0) return -1;
                    return 0;
                });
            }
            currentProduct = data;
            renderProductDetail(data);
            document.title = data.name;
            loadSidebarRecommendations();
        }
    } catch (e) {
        console.error(e);
        showError('商品加载失败，请检查网络');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    if (!currentProduct) initProductPage();
});

// =============================================
// === 核心渲染逻辑
// =============================================

function renderProductDetail(p) {
    const container = document.getElementById('product-content');
    const loading = document.getElementById('product-loading');
    
    if (!container) return;

    // 1. 初始不选中规格，计算价格区间
    currentVariant = null; 
    let priceDisplay = '0.00';
    let totalStock = 0;

    if (p.variants && p.variants.length > 0) {
        totalStock = p.variants.reduce((sum, v) => sum + (parseInt(v.stock) || 0), 0);
        const prices = p.variants.map(v => parseFloat(v.price));
        const minPrice = Math.min(...prices);
        const maxPrice = Math.max(...prices);
        priceDisplay = minPrice !== maxPrice ? `${minPrice.toFixed(2)}-${maxPrice.toFixed(2)}` : minPrice.toFixed(2);
    }

    // 2. 构建 HTML 结构
    // 移动端使用 d-lg-none (小于992px显示)
    // PC端使用 d-none d-lg-flex (大于等于992px显示)
    const html = `
        <div class="module-box product-showcase">
            <div class="row g-0">
                <div class="col-md-5">
                    <div class="p-3 border rounded bg-light">
                        <div class="main-img-wrap mb-2" style=" position:relative;padding-bottom:calc(100% - 2px);overflow:hidden;">
                            <img id="p-main-img" src="${p.image_url}" class="position-absolute w-100 h-100" style="object-fit:contain; top:0; left:0; z-index: 1;border-radius: 10px;">
                            
                            <div class="d-flex d-lg-none align-items-center justify-content-center position-absolute w-100" 
                                 style="bottom:0; left:0; background: rgb(255 255 255 / 55%); backdrop-filter:blur(3px);border-radius: 0 0 10px 10px;z-index: 10;">
                                
                                <div class="action-icon-wrap d-flex align-items-center me-2" style="color:#555;">
                                    <i class="fas fa-qrcode fs-5 me-2"></i> 手机购买
                                    <div class="qr-popup text-center" style="width: 140px; top:auto; bottom:100%; margin-bottom:12px; margin-top:0;">
                                        <div id="page-qrcode-mobile" style="margin-bottom: 5px;"></div>
                                        <div class="small text-muted">微信/手机扫码下单</div>
                                    </div>
                                </div>
                                
                                <div class="action-icon-wrap d-flex align-items-center" style="color:#555;">
                                    <i class="fas fa-share-alt fs-5 me-2"></i> 分享商品
                                    <div class="share-popup" style="width: 240px; top:auto; bottom:100%; margin-bottom:12px; margin-top:0;"> 
                                        <div class="d-flex justify-content-center flex-wrap p-1">
                                            <a href="javascript:void(0)" onclick="shareTo('wechat')" class="share-icon-link share-wx" title="分享到微信"><i class="fab fa-weixin"></i></a>
                                            <a href="javascript:void(0)" onclick="shareTo('qq')" class="share-icon-link share-qq" title="分享到QQ"><i class="fab fa-qq"></i></a>
                                            <a href="javascript:void(0)" onclick="shareTo('telegram')" class="share-icon-link share-tg" title="分享到Telegram"><i class="fab fa-telegram-plane"></i></a>
                                            <a href="javascript:void(0)" onclick="shareTo('facebook')" class="share-icon-link share-fb" title="分享到Facebook"><i class="fab fa-facebook-f"></i></a>
                                            <a href="javascript:void(0)" onclick="shareTo('twitter')" class="share-icon-link share-tw" title="分享到Twitter"><i class="fab fa-twitter"></i></a>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div class="d-none d-lg-flex align-items-center mt-3 text-secondary">
                            <div class="action-icon-wrap d-flex align-items-center">
                                <i class="fas fa-qrcode fs-5 me-2"></i> 手机购买
                                <div class="qr-popup text-center" style="width: 140px;">
                                    <div id="page-qrcode-pc" style="margin-bottom: 5px;"></div>
                                    <div class="small text-muted">微信/手机扫码下单</div>
                                </div>
                            </div>
                            <div class="action-icon-wrap d-flex align-items-center">
                                <i class="fas fa-share-alt fs-5 me-2"></i> 分享商品
                                <div class="share-popup" style="width: 240px;"> 
                                    <div class="d-flex justify-content-center flex-wrap p-1">
                                        <a href="javascript:void(0)" onclick="shareTo('wechat')" class="share-icon-link share-wx" title="分享到微信"><i class="fab fa-weixin"></i></a>
                                        <a href="javascript:void(0)" onclick="shareTo('qq')" class="share-icon-link share-qq" title="分享到QQ"><i class="fab fa-qq"></i></a>
                                        <a href="javascript:void(0)" onclick="shareTo('telegram')" class="share-icon-link share-tg" title="分享到Telegram"><i class="fab fa-telegram-plane"></i></a>
                                        <a href="javascript:void(0)" onclick="shareTo('facebook')" class="share-icon-link share-fb" title="分享到Facebook"><i class="fab fa-facebook-f"></i></a>
                                        <a href="javascript:void(0)" onclick="shareTo('twitter')" class="share-icon-link share-tw" title="分享到Twitter"><i class="fab fa-twitter"></i></a>
                                    </div>
                                </div>
                            </div>
                        </div>

                    </div>
                </div>

                <div class="col-md-7" style="position:relative;">
                    <div class="p-3">
                        <h5 class="fw-bold mb-2" style="line-height:1.4;" id="product-title-el">${p.name}</h5>
                        
                        <div class="tb-tags-row mb-2" id="p-tags-container">
                            ${renderProductTags(p.tags)}
                        </div>

                        <div class="stock-sales-row">
                            <span class="me-3">库存: <span id="p-stock">${totalStock}</span></span>
                            <span>销量: ${p.variants.reduce((a,b)=>a+(b.sales_count||0), 0)}</span>
                        </div>

                        <div id="number-selector-modal" class="number-selector-overlay">
                            <div class="ns-header">
                                <span>请选择号码</span>
                                <span class="ns-close" onclick="closeNumberSelector()">×</span>
                            </div>
                            <div class="ns-body">
                                <div id="ns-list-container" class="ns-grid">
                                    <div class="text-center w-100 mt-3 text-muted">请先选择规格</div>
                                </div>
                            </div>
                            <div class="ns-footer" onclick="closeNumberSelector()">
                                ︽ 收起
                            </div>
                        </div>

                        <div class="price-bar bg-light p-3 rounded mb-2">
                            <div class="d-flex justify-content-between align-items-start">
                                <div class="d-flex align-items-baseline text-danger">
                                    <span class="fw-bold me-1" style="font-size: 18px;">¥</span>
                                    <span class="fs-1 fw-bold" id="p-display-price" style="line-height: 1;">${priceDisplay}</span>
                                </div>
                            </div>

                            <div id="dynamic-info-display" style="display:block; margin-top:8px; padding-top:8px; border-top:1px dashed #ddd; min-height:28px;">
                            </div>
                        </div>

                        <div class="sku-section mb-2">
                            <div class="mb-2 text-secondary small">选择规格 <span class="fw-normal text-muted" style="font-size: 0.9em;">(共${p.variants ? p.variants.length : 0}个)</span>：</div>
                            <div class="sku-list d-flex flex-wrap" id="sku-btn-list">
                                ${renderSkuButtons(p.variants, -1)} 
                            </div>
                            <div id="spec-pagination-area" class="spec-pagination-container"></div>
                        </div>

                        <div class="mb-3 d-flex align-items-center flex-wrap" id="buy-method-wrapper">
                            <span class="text-secondary small me-3 text-nowrap">购买方式：</span>
                            <div class="d-flex align-items-center flex-wrap" id="buy-method-container">
                                <span class="text-muted small" style="padding: 5px 0;">请先选择规格</span>
                            </div>
                        </div>

                        <div class="mb-3 d-flex align-items-center">
                            <span class="text-secondary small me-3">数量：</span>
                            <div class="input-group" style="width: 120px;">
                                <button class="btn btn-outline-secondary btn-sm" type="button" onclick="changeQty(-1)">-</button>
                                <input type="text" class="form-control form-control-sm text-center input-light" id="buy-qty" value="1">
                                <button class="btn btn-outline-secondary btn-sm" type="button" onclick="changeQty(1)">+</button>
                            </div>
                        </div>
                        
                        <div class="mb-3 d-flex align-items-center">
                            <span class="text-secondary small me-3">信息：</span>
                            <div class="d-flex flex-grow-1">
                                <input type="text" class="form-control form-control-sm me-2 input-light" id="p-contact" placeholder="请输入QQ/手机/邮箱">
                                <input type="text" class="form-control form-control-sm input-light" id="p-password" placeholder="请设置查单密码">
                            </div>
                        </div>

                        <div class="mb-4 d-flex align-items-center flex-wrap">
                            <span class="text-secondary small me-3 text-nowrap">支付方式：</span>
                            <div class="d-flex align-items-center flex-wrap" id="payment-method-list">
                                <span class="spinner-border spinner-border-sm text-secondary"></span>
                            </div>
                        </div>

                        <div class="action-btns d-flex mt-4 align-items-center">
                            <a href="/cart" class="d-none d-lg-flex align-items-center justify-content-center me-3 position-relative p-0" style="border: none; background: none; color: #dc3545; text-decoration: none; width: 40px; height: 40px;">
                                <i class="far fa-shopping-cart" style="font-size: 1.5rem;"></i>
                                <span id="pc-detail-cart-badge" class="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-danger text-white" style="display: none; font-size: 10px; padding: 3px 6px; transform: translate(-50%, -50%) !important;">0</span>
                            </a>
                            
                            <button class="btn btn-warning text-white fw-bold py-2 me-2" style="flex: 1 1 0%;" onclick="addToCart()">
                                <i class="fa fa-cart-plus"></i> 加入购物车
                            </button>
                            <button class="btn btn-danger fw-bold py-2" style="flex: 1 1 0%;" onclick="buyNow()">
                                立即购买
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <div class="module-box mt-3">
            <div class="border-bottom pb-2 mb-3">
                <span class="fw-bold border-bottom border-3 border-danger pb-2 px-1">商品详情</span>
            </div>
            <div class="product-desc p-2" style="overflow-x:auto;">
                ${p.description || '<div class="text-center text-muted py-5">暂无详细介绍</div>'}
            </div>
        </div>
    `;

    container.innerHTML = html;
    if(loading) loading.style.display = 'none';
    container.style.display = 'block';

    // 3. 初始化后续逻辑
    updateBuyMethodButtons(); 
    updateDynamicInfoDisplay(); 
    updatePcDetailCartBadge(); 
    
    // 回显缓存信息
    const cachedContact = localStorage.getItem('userContact');
    const cachedPass = localStorage.getItem('userPassword');
    if(cachedContact) {
        const el = document.getElementById('p-contact');
        if(el) el.value = cachedContact;
    }
    if(cachedPass) {
        const el = document.getElementById('p-password');
        if(el) el.value = cachedPass;
    }
    // 初始化二维码
    initPageQrcode();
    loadPaymentGateways();
    // 侧边栏推荐
    if (typeof checkSidebarStatus === 'function') setTimeout(checkSidebarStatus, 200);
    
    // 规格分页初始化
    setTimeout(() => {
         if (typeof initSpecPagination === 'function') {
             initSpecPagination('#sku-btn-list', '.sku-btn', 6);
         }
    }, 100);
}

// =============================================
// === 交互逻辑 (规格、价格、弹窗等)
// =============================================

function parseWholesaleInfo(config) {
    if (!config) return null;
    let rules = [];
    let data = config;
    if (typeof data === 'string') {
        data = data.trim();
        if (data.startsWith('[') || data.startsWith('{')) {
            try { data = JSON.parse(data); } catch (e) { /* fallback */ }
        }
    }
    if (Array.isArray(data)) {
        data.forEach(item => {
            const n = item.num || item.number || item.count || item.qty || item.n;
            const p = item.price || item.money || item.amount || item.p;
            if (n && p) rules.push(`${n}个起${p}元/1个`);
        });
    } else if (typeof data === 'object' && data !== null) {
        Object.entries(data).forEach(([k, v]) => { if(!isNaN(k)) rules.push(`${k}个起${v}元/1个`); });
    }
    return rules.length > 0 ? rules.join('，') : '';
}

function updateBuyMethodButtons() {
    const container = document.getElementById('buy-method-container');
    if (!container) return;

    if (!currentVariant) {
        container.innerHTML = '<span class="text-muted small" style="padding: 5px 0;">请先选择规格</span>';
        buyMethod = null;
        return;
    }

    const markup = parseFloat(currentVariant.custom_markup || 0);
    const showSelect = markup > 0;
    let label = currentVariant.selection_label || '自选卡密/号码';

    if (buyMethod === 'select' && !showSelect) buyMethod = null;

    let html = '';
    const randomClass = buyMethod === 'random' ? 'btn-danger' : 'btn-outline-secondary';
    let randomLabel = currentVariant.random_mode_text || '默认随机';
    html += `<button class="btn btn-sm ${randomClass} me-2 mb-1 method-btn" data-type="random" onclick="selectBuyMethod('random', this)">${randomLabel}</button>`;

    if (showSelect) {
        const selectClass = buyMethod === 'select' ? 'btn-danger' : 'btn-outline-secondary';
        html += `<button class="btn btn-sm ${selectClass} mb-1 method-btn" data-type="select" onclick="selectBuyMethod('select', this)">${label} (加价${markup.toFixed(2)}元)</button>`;
    }
    container.innerHTML = html;
}

function selectBuyMethod(type, btn) {
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
}

async function openNumberSelector() {
    const modal = document.getElementById('number-selector-modal');
    const listContainer = document.getElementById('ns-list-container');
    const titleEl = document.getElementById('product-title-el');
    const buyMethodEl = document.getElementById('buy-method-wrapper');
    
    if (!modal || !currentVariant) return;

    modal.style.display = 'flex';
    modal.style.flexDirection = 'column';
    modal.style.position = 'absolute';
    modal.style.left = '16px'; 
    modal.style.right = '16px';
    modal.style.width = 'auto';
    modal.style.zIndex = '100';
    modal.style.background = '#fff';
    modal.style.boxShadow = '0 -4px 20px rgba(0,0,0,0.15)';
    modal.style.border = '1px solid #eee';
    modal.style.borderRadius = '8px 8px 0 0';
    modal.style.overflow = 'hidden';
    modal.style.transition = 'height 0.3s cubic-bezier(0.25, 0.8, 0.25, 1), opacity 0.2s';

    const nsBody = modal.querySelector('.ns-body');
    if(nsBody) {
        nsBody.style.overflowY = 'auto';
        nsBody.style.flex = '1';
    }

    const parent = modal.offsetParent || modal.parentElement;
    const parentHeight = parent.clientHeight;
    const buyTop = buyMethodEl.offsetTop; 
    const titleBottom = titleEl.offsetTop + titleEl.offsetHeight; 

    const bottomPos = parentHeight - buyTop;
    modal.style.bottom = bottomPos + 'px';
    modal.style.top = 'auto';

    const maxHeight = buyTop - titleBottom - 15; 
    modal.style.maxHeight = maxHeight + 'px';

    modal.classList.add('active');
    modal.style.height = '0px';
    modal.style.opacity = '0';
    
    listContainer.innerHTML = '<div class="text-center w-100 mt-3"><i class="fa fa-spinner fa-spin"></i> 加载中...</div>';
    
    requestAnimationFrame(() => {
        modal.style.opacity = '1';
        modal.style.height = Math.min(100, maxHeight) + 'px';
    });

    try {
        const res = await fetch(`/api/shop/cards/notes?variant_id=${currentVariant.id}`);
        const data = await res.json();

        if (Array.isArray(data) && data.length > 0) {
            let html = '';
            data.forEach(item => {
                const isSelected = selectedSpecificCardId === item.id ? 'selected' : '';
                html += `<div class="ns-item ${isSelected}" style="cursor:pointer;" onclick="selectNumberItem(${item.id}, '${item.note}')">${item.note}</div>`;
            });
            listContainer.innerHTML = html;
        } else {
            listContainer.innerHTML = '<div class="text-center w-100 mt-3 text-muted">暂无可自选号码</div>';
        }

        const headerHeight = modal.querySelector('.ns-header').offsetHeight || 40;
        const footerHeight = modal.querySelector('.ns-footer') ? modal.querySelector('.ns-footer').offsetHeight : 0;
        const contentHeight = listContainer.scrollHeight + headerHeight + footerHeight + 20; 
        const finalHeight = Math.min(contentHeight, maxHeight);
        modal.style.height = finalHeight + 'px';

    } catch (e) {
        console.error(e);
        listContainer.innerHTML = '<div class="text-center w-100 mt-3 text-danger">加载失败</div>';
    }
}

function closeNumberSelector() {
    const modal = document.getElementById('number-selector-modal');
    if (modal) {
        modal.style.height = '0px';
        modal.style.opacity = '0';
        setTimeout(() => {
            modal.classList.remove('active');
        }, 300); 
    }
}

function selectNumberItem(id, note) {
    selectedSpecificCardId = id;
    selectedSpecificCardInfo = note;
    
    const items = document.querySelectorAll('.ns-item');
    items.forEach(el => el.classList.remove('selected'));
    event.target.classList.add('selected');
    
    updateDynamicInfoDisplay();
    updateRealTimePrice();
    
    setTimeout(closeNumberSelector, 200);
}

function updateDynamicInfoDisplay() {
    const displayDiv = document.getElementById('dynamic-info-display');
    if (!displayDiv) return;

    if (!currentVariant || buyMethod === null) {
        displayDiv.style.display = 'block';
        displayDiv.innerHTML = '<span style="color:#999; font-size:13px;"><i class="fa fa-info-circle me-1"></i> 请选择规格和购买方式</span>';
        return;
    }

    displayDiv.style.display = 'block';
    const specName = currentVariant.name || currentVariant.specs || '默认规格';

    let leftHtml = '';
    const redStyle = 'color:#dc3545; font-size:13px; font-weight:500;';
    
    if (buyMethod === 'random') {
        const promoText = parseWholesaleInfo(currentVariant.wholesale_config);
        if (promoText) {
            leftHtml = `<span style="${redStyle}"><i class="fa fa-tag me-1"></i>批发优惠: ${promoText}</span>`;
        } else {
            let randomLabel = currentVariant.random_mode_text || '默认随机';
            leftHtml = `<span style="${redStyle}"> ${randomLabel}</span>`;
        }
    } else if (buyMethod === 'select') {
        const markup = parseFloat(currentVariant.custom_markup || 0).toFixed(2);
        let label = currentVariant.selection_label || '自选卡密/号码';
        leftHtml = `<span style="${redStyle}">${label} (加价 ${markup}元)</span>`;
    }

    let rightInfo = specName;
    if (buyMethod === 'select' && selectedSpecificCardInfo) {
        rightInfo += ` + ${selectedSpecificCardInfo}`;
    }

    const rightHtml = `<span style="${redStyle} margin-right:8px;"><i class="fa fa-check-circle me-1"></i>已选: ${rightInfo}</span>`;
        displayDiv.innerHTML = rightHtml + leftHtml;
}

function selectSku(index, btn) {
    if (!currentProduct) return;

    if (currentVariant && currentVariant.id === currentProduct.variants[index].id) {
        currentVariant = null;
        buyMethod = null;
        selectedSpecificCardId = null;
        selectedSpecificCardInfo = '';
        closeNumberSelector();

        document.querySelectorAll('.sku-btn').forEach(b => {
            b.classList.remove('btn-danger', 'active');
            b.classList.add('btn-outline-secondary');
        });
        
        document.getElementById('p-main-img').src = currentProduct.image_url;
        const totalStock = currentProduct.variants.reduce((sum, v) => sum + (parseInt(v.stock) || 0), 0);
        document.getElementById('p-stock').innerText = totalStock;

        updateBuyMethodButtons();
        updateDynamicInfoDisplay();
        updateRealTimePrice();
        return;
    }
    
    document.querySelectorAll('.sku-btn').forEach(b => {
        b.classList.remove('btn-danger', 'active');
        b.classList.add('btn-outline-secondary');
    });
    btn.classList.remove('btn-outline-secondary');
    btn.classList.add('btn-danger');

    const variant = currentProduct.variants[index];
    currentVariant = variant;
    
    const imgUrl = variant.image_url || currentProduct.image_url;
    document.getElementById('p-main-img').src = imgUrl;
    document.getElementById('p-stock').innerText = variant.stock;

    buyMethod = null;
    selectedSpecificCardId = null;
    selectedSpecificCardInfo = '';
    closeNumberSelector();

    updateBuyMethodButtons();
    updateDynamicInfoDisplay();
    updateRealTimePrice();
}

function renderSkuButtons(variants, selectedIdx = -1) {
    if (!variants || variants.length === 0) return '<span class="text-muted">默认规格</span>';
    return variants.map((v, index) => {
        const isOOS = v.stock <= 0;
        const isSelected = (selectedIdx !== -1) && (index === selectedIdx);
        let btnClass = isSelected ? 'btn-danger' : 'btn-outline-secondary';
        if (isOOS) btnClass += ' no-stock';    
        // 1. [新增] 格式化价格
        const priceStr = parseFloat(v.price).toFixed(2);

        const name = v.name || v.specs || `规格${index+1}`;
        const badgeHtml = isOOS ? '<span class="sku-oos-badge">缺货</span>' : '';    
        // 2. [修改] 在名称后面显示价格 (￥...)
        return `<button class="btn btn-sm ${btnClass} me-2 mb-2 sku-btn" data-idx="${index}" onclick="${isOOS ? '' : `selectSku(${index}, this)`}" ${isOOS ? 'disabled' : ''}>${name} (￥${priceStr})${badgeHtml}</button>`;
    }).join('');
}

function renderProductTags(tags) {
    if (!tags) return '';
    let tagList = typeof tags === 'string' ? tags.split(',') : tags;
    if (!Array.isArray(tagList) || tagList.length === 0) return '';
    
    return tagList.map(tagStr => {
        let borderColor = '#dc3545', bgColor = '#dc3545', textColor = '#ffffff';
        let text = tagStr.trim();
        if(!text) return '';
        
        const b1 = text.match(/b1#([0-9a-fA-F]{3,6})/);
        if(b1) { borderColor='#'+b1[1]; text=text.replace(b1[0],'').trim(); }
        const b2 = text.match(/b2#([0-9a-fA-F]{3,6})/);
        if(b2) { bgColor='#'+b2[1]; text=text.replace(b2[0],'').trim(); }
        const c = text.match(/#([0-9a-fA-F]{3,6})$/);
        if(c) { textColor='#'+c[1]; text=text.substring(0,c.index).trim(); }
        return `<span class="dynamic-tag" style="border-color:${borderColor}; background-color:${bgColor}; color:${textColor};">${text}</span>`;
    }).join('');
}

function selectPayment(type, el) {
    paymentMethod = type;
    document.querySelectorAll('.payment-option').forEach(opt => opt.classList.remove('active'));
    el.classList.add('active');
}

function changeQty(delta) {
    let newQty = quantity + delta;
    if (newQty < 1) newQty = 1;
    
    if (buyMethod === 'select') {
        newQty = 1;
    } else {
        if (currentVariant && newQty > currentVariant.stock) {
            alert('库存不足');
            newQty = currentVariant.stock;
        }
    }
    
    quantity = newQty;
    document.getElementById('buy-qty').value = quantity;
    updateRealTimePrice();
}

// =============================================
// === 1. [重点] 加入购物车
// =============================================
function addToCart() {
    if (!currentVariant) { alert('请先选择规格'); return; }
    if (currentVariant.stock <= 0) { alert('该规格缺货'); return; }
    if (buyMethod === null) { alert('请选择购买方式'); return; }

    if (buyMethod === 'select') {
        if (!selectedSpecificCardId) {
            alert('请选择一个号码/卡密');
            openNumberSelector(); 
            return;
        }
    }

    const contactEl = document.getElementById('p-contact');
    const passEl = document.getElementById('p-password');
    if (contactEl && passEl) {
        const c = contactEl.value.trim();
        const p = passEl.value.trim();
        if(c) localStorage.setItem('userContact', c);
        if(p) localStorage.setItem('userPassword', p);
    }

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
    if (typeof updateCartBadge === 'function') updateCartBadge(cart.length);
    updatePcDetailCartBadge(); 
    
    // UI 反馈
    const btn = event.target;
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fa fa-check"></i> 已加入';
    btn.classList.add('btn-success');
    setTimeout(() => {
        btn.innerHTML = originalText;
        btn.classList.remove('btn-success');
    }, 1500);
}
// =============================================
// === 2. [重点修改] 立即购买 (修复数量检测 + 拦截未支付)
// =============================================
async function buyNow() {
    if (!currentVariant) { alert('请先选择规格'); return; }
    if (buyMethod === null) { alert('请选择购买方式'); return; }
    
    // === 新增：强制读取输入框的最新数量并检查库存 ===
    const qtyInput = document.getElementById('buy-qty');
    if (qtyInput) {
        let val = parseInt(qtyInput.value);
        if (isNaN(val) || val < 1) val = 1;
        
        // 自选模式强制为1
        if (buyMethod === 'select') val = 1;
        
        // 检查库存
        if (currentVariant && val > currentVariant.stock) {
            alert(`库存不足，当前仅剩 ${currentVariant.stock} 件`);
            qtyInput.value = currentVariant.stock; // 自动修正为最大库存
            quantity = currentVariant.stock;
            updateRealTimePrice(); // 刷新一下价格显示
            return; // 阻止下单
        }
        quantity = val; // 更新全局变量
    }
    // ===========================================

    if (buyMethod === 'select') {
        if (!selectedSpecificCardId) {
            alert('请选择一个号码/卡密');
            openNumberSelector(); 
            return;
        }
    }

    const contactEl = document.getElementById('p-contact');
    const passEl = document.getElementById('p-password');
    
    if (!contactEl || !passEl) {
        alert('页面加载异常，请刷新重试');
        return;
    }

    const contact = contactEl.value.trim();
    const password = passEl.value.trim();

    if (!contact) {
        alert('请输入联系方式');
        contactEl.focus();
        return;
    }
    if (!password || password.length < 1) {
        alert('查单密码长度必须大于1位');
        passEl.focus();
        return;
    }

    localStorage.setItem('userContact', contact);
    localStorage.setItem('userPassword', password);

    const btn = event.currentTarget || event.target;
    const originalContent = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa fa-spinner fa-spin"></i> 正在下单...';

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
            // [新增] 拦截未支付订单错误
            if (data.error.includes('未支付订单')) {
                // 弹出确认框
                if(confirm('提示：' + data.error + '\n\n点击“确定”前往查单页面处理。')) {
                    // 跳转到查单页
                    window.location.href = '/orders';
                    return; // 阻止后续逻辑
                }
            } else {
                alert(data.error);
            }
            
            btn.disabled = false;
            btn.innerHTML = originalContent;
        } else {
            window.location.href = `/pay?order_id=${data.order_id}&method=${paymentMethod}`;
        }

    } catch (e) {
        console.error(e);
        alert('网络请求失败，请检查网络');
        btn.disabled = false;
        btn.innerHTML = originalContent;
    }
}
function showError(msg) {
    const container = document.getElementById('product-loading');
    if (container) container.innerHTML = `<div class="text-danger py-5"><i class="fa fa-exclamation-triangle"></i> ${msg}</div>`;
}

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
        html += `<span style="margin:0 8px; color:#666; font-size:14px;">${currentPage} / ${totalPages}</span>`;
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
    window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(calculatePages, 300); });
}

async function loadSidebarRecommendations() {
    try {
        const res = await fetch('/api/shop/products');
        const allProducts = await res.json();
        if (typeof renderSidebarTopSales === 'function') renderSidebarTopSales(allProducts);
        if (typeof checkSidebarStatus === 'function') checkSidebarStatus();
    } catch(e) {}
}

function updateRealTimePrice() {
    const priceEl = document.getElementById('p-display-price');
    if (!priceEl) return;

    if (!currentVariant) {
        if (currentProduct && currentProduct.variants && currentProduct.variants.length > 0) {
            const prices = currentProduct.variants.map(v => parseFloat(v.price));
            const minPrice = Math.min(...prices);
            const maxPrice = Math.max(...prices);
            priceEl.innerText = minPrice !== maxPrice ? `${minPrice.toFixed(2)}-${maxPrice.toFixed(2)}` : minPrice.toFixed(2);
        } else {
            priceEl.innerText = '0.00';
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
            displayHTML = `<span style="font-size:0.5em; color:#666; vertical-align: middle;">${basePrice.toFixed(2)} + ${markup.toFixed(2)} = </span>${totalPrice.toFixed(2)}`;
        }
        
        if (quantity > 1) {
             quantity = 1;
             document.getElementById('buy-qty').value = 1;
        }
    }

    priceEl.innerHTML = displayHTML;
}

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

// [新增] 更新PC端详情页购物车图标角标
function updatePcDetailCartBadge() {
    const badge = document.getElementById('pc-detail-cart-badge');
    if (!badge) return;
    try {
        const cart = JSON.parse(localStorage.getItem('tbShopCart') || '[]');
        const count = cart.length; 
        
        if (count > 0) {
            badge.innerText = count;
            badge.style.display = 'inline-block';
        } else {
            badge.style.display = 'none';
        }
    } catch(e) {
        console.error('更新角标失败', e);
    }
}
// =============================================
// === [新增] 二维码与分享功能
// =============================================

function initPageQrcode() {
    // 封装通用初始化函数
    const init = (id) => {
        const el = document.getElementById(id);
        if (el && typeof QRCode !== 'undefined') {
            el.innerHTML = ''; // 清空旧的
            new QRCode(el, {
                text: window.location.href,
                width: 120,
                height: 120,
                colorDark : "#000000",
                colorLight : "#ffffff",
                correctLevel : QRCode.CorrectLevel.H
            });
        }
    };

    // 初始化两个ID（一个用于移动端，一个用于PC端）
    init('page-qrcode-mobile');
    init('page-qrcode-pc');
}

// 修改后的 shareTo 函数：点击任意图标均复制链接
function shareTo(platform) {
    // 无论点击哪个图标，逻辑都是复制当前链接
    const url = window.location.href;

    // 使用 Clipboard API (现代浏览器)
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(url).then(() => {
            alert('分享链接已经复制成功了，赶快发给好友吧！');
        }).catch(err => {
            // 如果 API 失败，尝试降级方案
            fallbackCopy(url);
        });
    } else {
        // 降级方案 (兼容旧浏览器或非HTTPS环境)
        fallbackCopy(url);
    }
}

// 辅助函数：兼容性复制
function fallbackCopy(text) {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    
    // 设置样式防止元素出现在可视区域干扰用户
    textArea.style.position = "fixed";
    textArea.style.left = "-9999px";
    textArea.style.top = "0";
    
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    
    try {
        const successful = document.execCommand('copy');
        if (successful) {
            alert('分享链接已经复制成功了，赶快发给好友吧！');
        } else {
            alert('复制失败，请手动复制浏览器地址栏。');
        }
    } catch (err) {
        alert('复制失败，请手动复制浏览器地址栏。');
    }
    
    document.body.removeChild(textArea);
}
// =============================================
// === 新增：处理手动输入数量 ===
// =============================================
function manualChangeQty(el) {
    let val = parseInt(el.value);
    // 1. 基础验证：必须是正整数
    if (isNaN(val) || val < 1) {
        val = 1;
    }
    // 2. 自选模式限制：只能买 1 个
    if (buyMethod === 'select') {
        if (val > 1) {
            alert('自选号码/卡密模式下，每次只能购买 1 个');
        }
        val = 1;
    } 
    // 3. 随机模式限制：不能超过库存
    else if (currentVariant) {
        if (val > currentVariant.stock) {
            alert(`库存不足，当前仅剩 ${currentVariant.stock} 件`);
            val = currentVariant.stock;
        }
    }
    // 4. 更新数据和界面
    quantity = val;
    el.value = val;
    updateRealTimePrice();
}
async function loadPaymentGateways() {
    try {
        const res = await fetch('/api/shop/gateways');
        const list = await res.json();
        const container = document.getElementById('payment-method-list');
        if(!container) return;
        if (!list || list.length === 0) { container.innerHTML = '<small class="text-muted">暂无支付方式</small>'; return; }
        
        let html = '';
        paymentMethod = list[0].id; // 默认选中第一个的 ID
        list.forEach((g, index) => {
            const activeClass = index === 0 ? 'active' : '';
            let iconHtml = '<i class="fas fa-credit-card"></i>';
            
            // 优先使用后台自定义图标，如果未填写则按默认格式显示
            if (g.icon) {
                iconHtml = `<img src="${g.icon}" style="width:20px; height:20px; object-fit:contain;"> <span style="font-size:13px; font-weight:bold; margin-left:4px;">${g.name}</span>`;
            } else {
                iconHtml = `<i class="fas fa-credit-card" style="color:#1678ff;"></i> <span style="font-size:13px; font-weight:bold; margin-left:4px;">${g.name}</span>`;
            }
            
            html += `<div class="payment-option ${activeClass}" onclick="selectPayment('${g.id}', this)" title="${g.name}">
                        ${iconHtml}<div class="payment-check-mark"><i class="fa fa-check"></i></div>
                     </div>`;
        });
        container.innerHTML = html;
    } catch (e) { console.error(e); }
}
