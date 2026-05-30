// =============================================
// === themes/TBshop/files/common.js
// === (全局共享JS + 公共布局渲染 - 完整修复版)
// === 包含：页头样式修复 + 移动端分类侧边栏 + 所有PC端功能
// =============================================

// ============================================================
// === 1. 公共布局模版系统
// ============================================================

const TB_LAYOUT = {
    // 移动端头部
    mobileHeader: `
        <div class="mh-left" id="mobile-menu-btn" onclick="togglePanel('mobile-sidebar', 'mobile-overlay')">
            <i class="fa fa-bars"></i>
        </div>
        <div class="mh-center">
            <a href="/" class="d-flex align-items-center justify-content-center h-100">
                <img id="mobile-logo-img" class="d-none" alt="Logo" style="height: 41px;">
                <span id="mobile-site-name-wrap" class="d-none">
                    <span id="mobile-header-site-name"></span>
                </span>
            </a>
        </div>
        <div class="mh-right" id="mobile-search-btn" onclick="toggleMobileSearch()">
            <i class="fa fa-search"></i>
        </div>
    `,
    pcHeader: (activePage) => `
        <div class="container header-inner">
            <a href="/" class="site-brand">
                <img id="site-logo" class="d-none" style="max-height: 45px; width: auto; margin-right: 10px;" alt="Logo">
                <span id="site-name-wrap" class="d-flex align-items-center d-none">
                    <span id="header-site-name"></span>
                </span>
            </a>
            <style>
                /* 二级菜单悬停滑出样式 */
                .tb-nav-dropdown { position: relative; height: 100%; display: flex; align-items: center; cursor: pointer; }
                .tb-nav-dropdown .dropdown-menu {
                    visibility: hidden; opacity: 0; transform: translateY(10px); transition: all 0.3s ease;
                    display: block; margin-top: 3px; border: none; box-shadow: 0 4px 12px rgba(0,0,0,0.1); 
                    border-radius: 4px; padding: 13px 0; min-width: 140px; position: absolute; top: 100%; left: 0; z-index: 1050; background-color: #fff;
                }
                .tb-nav-dropdown:hover .dropdown-menu { visibility: visible; opacity: 1; transform: translateY(0); }
                .tb-nav-dropdown .nav-link-item { display: flex; align-items: center; }
                .category-arrow { margin-left: 5px; color: inherit; display: inline-flex; }
                .category-arrow i { transition: transform 0.3s ease; display: inline-block; transform: rotate(90deg); font-size: 12px; }
                .tb-nav-dropdown:hover .category-arrow i { transform: rotate(0deg); }
                .tb-nav-dropdown .dropdown-item { font-size: 14px; padding: 6px 10px; color: #555; text-decoration: none; display: flex; align-items: center; }
                .tb-nav-dropdown .dropdown-item:hover { background-color: #f8f9fa; color: var(--tb-orange, #ff6a00); }
                .tb-nav-dropdown .dropdown-item img { width: 14px; height: 14px; object-fit: cover; margin-right: 5px; border-radius: 2px; }
            </style>
            <nav class="main-nav d-none d-md-flex">
                <a href="/" class="nav-link-item ${activePage === 'home' ? 'active' : ''}" style="${activePage==='home'?'color:var(--tb-orange);':''}"><i class="fas fa-home" style="margin-right: 5px;"></i>商城首页</a>
                
                <div class="tb-nav-dropdown">
                    <a href="/#category-container" class="nav-link-item"><i class="fas fa-list-ul" style="margin-right: 5px;"></i>商品分类 <span class="category-arrow"><i class="far fa-angle-right"></i></span></a>
                    <ul class="dropdown-menu" id="pc-header-category-menu">
                        <li><span class="dropdown-item text-muted">加载中...</span></li>
                    </ul>
                </div>

                <a href="/orders" class="nav-link-item ${activePage === 'orders' ? 'active' : ''}" style="${activePage==='orders'?'color:var(--tb-orange);':''}"><i class="fas fa-search" style="margin-right: 5px;"></i>订单查询</a>
                
                <div class="tb-nav-dropdown">
                    <a href="/articles" class="nav-link-item ${activePage === 'articles' ? 'active' : ''}" style="${activePage==='articles'?'color:var(--tb-orange);':''}"><i class="fas fa-book-open" style="margin-right: 5px;"></i>教程文章 <span class="category-arrow"><i class="far fa-angle-right"></i></span></a>
                    <ul class="dropdown-menu" id="pc-header-article-category-menu">
                        <li><span class="dropdown-item text-muted">加载中...</span></li>
                    </ul>
                </div>

                <a href="/custom?alias=about-us" class="nav-link-item" target="_blank"><i class="fas fa-info-circle" style="margin-right: 5px;"></i>关于我们</a>
            </nav>
            <div class="header-right">
                <div class="tb-search-group">
                    <input type="text" id="search-input" class="tb-search-input" placeholder="搜索商品...">
                    <button class="tb-search-btn" onclick="doSearch('pc')">搜索</button>
                </div>
                <a href="/admin/" class="btn-login">登录</a>
            </div>
        </div>
    `,

    // 移动端侧滑菜单 (改为分类列表容器)
    mobileSidebar: (activePage) => `
        <div class="mobile-sidebar-header">
        <img id="tb-mobile-sidebar-logo" class="d-none" style="width: 100%;max-height: 130px;object-fit: cover;margin-bottom: 8px;border-radius: 6px;" alt="侧栏Logo">
            <h5 class="mobile-sidebar-title">商品分类</h5>
            <i class="far fa-times" style="position: absolute;right: 10px;top: 10px;color: #555;background: rgb(255 255 255 / 44%);width: 25px;height: 25px;border-radius: 50%;display: flex;align-items: center;justify-content: center;font-size: 16px;cursor: pointer;z-index: 10;" onclick="togglePanel('mobile-sidebar', 'mobile-overlay')"></i>
        </div>
        <div class="mobile-sidebar-content">
            <div id="mobile-category-list" class="d-flex flex-column">
                <div class="text-center py-3 text-muted"><i class="fa fa-spinner fa-spin"></i> 加载中...</div>
            </div>
        </div>
    `,

    // 移动端底部导航
    mobileBottomNav: (activePage) => `
        <a href="/" class="mbn-item ${activePage === 'home' ? 'active' : ''}">
            <i class="fa fa-home"></i>
            <span>商城</span>
        </a>
        <a href="#" class="mbn-item" onclick="event.preventDefault(); togglePanel('mobile-sidebar', 'mobile-overlay');">
            <i class="fa fa-th-large"></i>
            <span>分类</span>
        </a>
        <a href="/orders" class="mbn-item ${activePage === 'orders' ? 'active' : ''}">
            <i class="fa fa-file-alt"></i>
            <span>查单</span>
        </a>
        <a href="/cart" class="mbn-item ${activePage === 'cart' ? 'active' : ''}" style="position:relative;">
            <i class="far fa-shopping-cart"></i>
            <span>购物车</span>
             <span id="cart-badge-mobile" class="badge bg-danger rounded-pill" 
                  style="position: absolute; top: 2px; right: 15px; font-size: 8px; padding: 2px 4px; display: none;">0</span>
        </a>
        <a href="/articles" class="mbn-item ${activePage === 'articles' ? 'active' : ''}">
            <i class="fas fa-book"></i>
            <span>文章</span>
        </a>
    `,
    // [新增] 移动端搜索下拉框模板
    mobileSearch: `
        <div class="mobile-search-dropdown d-lg-none">
            <div class="tb-search-group">
                <input type="text" id="mobile-search-input" class="tb-search-input" placeholder="搜索商品...">
                <button class="tb-search-btn" onclick="doSearch('mobile')">搜索</button>
            </div>
        </div>
        <div class="mobile-search-overlay d-lg-none" id="mobile-search-overlay" onclick="toggleMobileSearch()"></div>
    `,
    // 页脚
    footer: `
        <div class="container">
            <div class="footer-links">
                <a href="/custom?alias=terms" target="_blank">服务条款</a> <a href="/custom?alias=disclaimer" target="_blank">免责声明</a> <a href="/custom?alias=about-us" target="_blank">关于我们</a>
                <p>Copyright @ 2026<a href="/" target="_blank">XYFK</a>基于 Cloudflare 构建</p>
            </div>
        </div>
    `,

    // PC右侧栏 (标准框架)
    pcSidebarStandard: `
        <div class="sidebar-inner">
            <div class="module-box" id="notice-module-box">
                <div class="module-title">店铺公告</div>
                <div class="notice-content" id="notice-box">
                    <i class="fa fa-spinner fa-spin"></i> 加载中...
                </div>
            </div>

            <div class="module-box" id="contact-module-box">
                <div class="module-title">联系客服</div>
                <div class="notice-content" id="contact-box">
                    暂无联系方式
                </div>
            </div>
            
            <div id="sidebar-extras">
                 <div class="module-box d-none" id="top-sales-box-container">
                    <div class="module-title">销量排行</div>
                    <div id="top-sales-list"></div>
                </div>
                <div class="module-box d-none" id="article-cat-box-container">
                     <div class="module-title">教程分类</div>
                     <div class="art-cat-list" id="article-cat-list"></div>
                </div>
                <div class="module-box d-none" id="tag-cloud-box-container">
                     <div class="module-title">热门标签</div>
                     <div class="tag-cloud" id="tag-cloud-list"></div>
                </div>
            </div>
        </div>
    `
};

/**
 * 核心函数：渲染页面公共布局
 */
function renderCommonLayout(activePage) {
    // 1. 注入 HTML
    const els = {
        'global-pc-header': TB_LAYOUT.pcHeader(activePage),
        'global-mobile-header': TB_LAYOUT.mobileHeader,
        'mobile-sidebar': TB_LAYOUT.mobileSidebar(activePage),
        'global-mobile-nav': TB_LAYOUT.mobileBottomNav(activePage),
        'global-sidebar-right': TB_LAYOUT.pcSidebarStandard
    };

    for (const [id, html] of Object.entries(els)) {
        const el = document.getElementById(id);
        if (el) el.innerHTML = html;
    }
    // 只要页面上找不到 .mobile-search-dropdown，我就加进去
    if (!document.querySelector('.mobile-search-dropdown') && TB_LAYOUT.mobileSearch) {
         document.body.insertAdjacentHTML('afterbegin', TB_LAYOUT.mobileSearch);
    }
    // 2. 右侧栏特殊处理 (显示隐藏的模块)
    if (document.getElementById('global-sidebar-right')) {
        const extras = ['top-sales-box-container', 'tag-cloud-box-container', 'article-cat-box-container'];
        const showExtras = ['home', 'product', 'article', 'articles', 'orders', 'pay'].includes(activePage);
        if(showExtras) {
             extras.forEach(id => {
                 const el = document.getElementById(id);
                 if(el) el.classList.remove('d-none');
             });
             // 自动加载侧边栏数据
             loadGlobalSidebarData();
        }
    }

    // 3. 注入购物车角标 (PC端)
    const headerRight = document.querySelector('.tb-header .header-right');
    if (headerRight && !document.getElementById('cart-btn-pc')) {
        const cartBtnHtml = `
        <a href="/cart" class="icon-btn-pc" id="cart-btn-pc" style="position: relative; margin-left: 0px; color: #ff0036; text-decoration: none;">
            <i class="far fa-shopping-cart" style="font-size: 20px;"></i>
            <span id="cart-badge-pc" class="badge bg-danger rounded-pill" style="position: absolute; top: -8px; right: -10px; font-size: 9px; padding: 2px 4px; display: none;">0</span>
        </a>`;
        const loginBtn = headerRight.querySelector('.btn-login');
        if (loginBtn) {
            loginBtn.insertAdjacentHTML('beforebegin', cartBtnHtml);
            loginBtn.style.marginLeft = "15px"; 
        }
    }

    // 4. [修复] 初始化移动端分类侧边栏 (之前丢失的部分)
    initMobileSidebar();

    // 5. 加载配置 & 更新角标
    loadGlobalConfig();
    loadCartBadge();
// 6. 加载PC端下拉菜单数据
    loadPcHeaderCategories();
    loadPcHeaderArticleCategories();
}

// === 新增：加载 PC 头部商品分类下拉 ===
async function loadPcHeaderCategories() {
    try {
        const res = await fetch('/api/shop/categories');
        const data = await res.json();
        let categories = [];
        if (data && data.code === 0 && data.data && Array.isArray(data.data.categories)) { categories = data.data.categories; } 
        else if (Array.isArray(data)) { categories = data; } 
        else if (data && data.categories) { categories = data.categories; }
        else if (data && data.results) { categories = data.results; }
        
        const menuContainer = document.getElementById('pc-header-category-menu');
        if (!menuContainer) return;
        
        if (categories.length === 0) {
            menuContainer.innerHTML = '<li><span class="dropdown-item text-muted">暂无分类</span></li>';
            return;
        }
        menuContainer.innerHTML = categories.map(cat => {
            const imgHtml = cat.image_url ? `<img src="${cat.image_url}" alt="icon">` : '';
            // 复用自带的 handleMobileCategoryClick 来处理点击跳转/分类筛选
            return `<li><a class="dropdown-item" href="javascript:void(0);" onclick="handleMobileCategoryClick(${cat.id})">${imgHtml}${cat.name}</a></li>`;
        }).join('');
    } catch (e) {
        const menuContainer = document.getElementById('pc-header-category-menu');
        if(menuContainer) menuContainer.innerHTML = '<li><span class="dropdown-item text-danger">加载失败</span></li>';
    }
}

// === 新增：加载 PC 头部文章分类下拉 ===
async function loadPcHeaderArticleCategories() {
    try {
        const res = await fetch('/api/shop/article/categories');
        const data = await res.json();
        let categories = Array.isArray(data) ? data : (data.results || []);
        
        const menuContainer = document.getElementById('pc-header-article-category-menu');
        if (!menuContainer) return;
        
        if (categories.length === 0) {
            menuContainer.innerHTML = '<li><span class="dropdown-item text-muted">暂无分类</span></li>';
            return;
        }
        menuContainer.innerHTML = categories.map(cat => 
            `<li><a class="dropdown-item" href="/articles?category_id=${cat.id}">${cat.name}</a></li>`
        ).join('');
    } catch (e) {
        const menuContainer = document.getElementById('pc-header-article-category-menu');
        if(menuContainer) menuContainer.innerHTML = '<li><span class="dropdown-item text-danger">加载失败</span></li>';
    }
}
/**
 * [修复] 初始化移动端侧边栏数据 (加载分类)
 */
async function initMobileSidebar() {
    const container = document.getElementById('mobile-category-list');
    if (!container) return;

    try {
        const res = await fetch('/api/shop/categories');
        const categories = await res.json();
        
        if (!categories || categories.length === 0) {
            container.innerHTML = '<div class="text-center py-3 text-white-50">暂无分类</div>';
            return;
        }
        let sidebarHtml = `<a href="javascript:void(0)" onclick="handleMobileCategoryClick('all')">
            <i class="fa fa-th-large" style="margin-right:3px;width:20px;text-align:center;flex-shrink:0;"></i> <span>所有商品</span>
        </a>`;
        sidebarHtml += categories.map(c => {
            const iconHtml = c.image_url 
                ? `<img src="${c.image_url}">`
                : `<i class="fa fa-angle-right" style="margin-right:10px;width:20px;text-align:center;flex-shrink:0;"></i>`;
            return `<a href="javascript:void(0)" onclick="handleMobileCategoryClick('${c.id}')">${iconHtml} <span>${c.name}</span></a>`;
        }).join('');
        container.innerHTML = sidebarHtml;
    } catch (e) {
        console.error('Sidebar categories load error:', e);
        container.innerHTML = '<div class="text-center py-3 text-white-50">加载失败</div>';
    }
}

/**
 * [修复] 处理移动端分类点击
 */
function handleMobileCategoryClick(catId) {
    togglePanel('mobile-sidebar', 'mobile-overlay'); // 关闭侧栏

    const path = window.location.pathname;
    // 如果在首页，直接筛选
    if (path === '/' || path === '/') {
        if (typeof filterCategory === 'function') {
            filterCategory(catId);
        } else {
            window.location.href = `/?cat=${catId}`;
        }
    } else {
        // 其他页面跳转
        window.location.href = `/?cat=${catId}`;
    }
}

/**
 * 全局加载侧边栏数据 (销量、文章分类等)
 */
async function loadGlobalSidebarData() {
    // 1. 如果有销量排行或标签云容器，加载商品数据
    const needProducts = document.getElementById('top-sales-list') || document.getElementById('tag-cloud-list');
    if (needProducts) {
        try {
            const res = await fetch('/api/shop/products');
            const products = await res.json();
            if (!products.error) {
                renderSidebarTopSales(products);
                renderSidebarTagCloud(products);
            }
        } catch(e) { console.error('Sidebar products load error:', e); }
    }

    // 2. 如果有文章分类容器，加载文章数据
    const needArticles = document.getElementById('article-cat-list');
    if (needArticles) {
        try {
            const res = await fetch('/api/shop/articles/list');
            const articles = await res.json();
            if (!articles.error) {
                renderSidebarArticleCats(articles);
            }
        } catch(e) { console.error('Sidebar articles load error:', e); }
    }
}

/**
 * 加载配置
 */
function loadGlobalConfig() {
    fetch('/api/shop/config')
        .then(res => res.json())
        .then(config => {
            renderGlobalHeaders(config);
            renderSidebarNoticeContact(config);
            const footerEl = document.getElementById('global-footer');
            if (footerEl) {
                footerEl.innerHTML = config.footer_html || config.custom_footer || config.footer_content || config.footer || TB_LAYOUT.footer;
            }
        })
        .catch(e => {
            console.warn('Config load failed:', e);
            const footerEl = document.getElementById('global-footer');
            if (footerEl) footerEl.innerHTML = TB_LAYOUT.footer; 
        });
}

// =============================================
// === 2. UI交互逻辑：Sticky Sidebar (全自动版)
// =============================================
let sidebar = null;
const sidebarOptions = {
    topSpacing: 80,
    bottomSpacing: 20,
    containerSelector: '#main-content-row', 
    innerWrapperSelector: '.sidebar-inner'
};

function checkSidebarStatus() {
    const sidebarWrapper = document.getElementById('sidebar-wrapper');
    const sidebarInner = sidebarWrapper ? sidebarWrapper.querySelector('.sidebar-inner') : null;
    const productArea = document.querySelector('.col-lg-9'); 
    
    if (!sidebarInner || !productArea) return;

    productArea.style.minHeight = '400px';

    const sbHeight = sidebarInner.offsetHeight;
    const contentHeight = productArea.offsetHeight;
    const isWideScreen = window.innerWidth >= 992;

    if (contentHeight < sbHeight || !isWideScreen) {
        if (sidebar) {
            sidebar.destroy();
            sidebar = null;
        }
    } else {
        if (!sidebar) {
            if (typeof StickySidebar !== 'undefined') {
                sidebar = new StickySidebar('#sidebar-wrapper', sidebarOptions);
            }
        } else {
            sidebar.updateSticky();
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    setTimeout(checkSidebarStatus, 100);
    const contentEl = document.querySelector('.col-lg-9');
    const sidebarInner = document.querySelector('.sidebar-inner');
    
    if (typeof ResizeObserver !== 'undefined') {
        if(contentEl) new ResizeObserver(() => checkSidebarStatus()).observe(contentEl);
        if(sidebarInner) new ResizeObserver(() => checkSidebarStatus()).observe(sidebarInner);
    }
});
window.addEventListener('resize', checkSidebarStatus);


// =============================================
// === 3. 共享逻辑 (搜索、侧栏、角标等)
// =============================================

function doSearch(source = 'pc') {
    const inputId = source === 'mobile' ? 'mobile-search-input' : 'search-input';
    const val = document.getElementById(inputId)?.value.trim();
    if (typeof renderSingleGrid === 'function' && typeof allProducts !== 'undefined') {
        if (!val) renderCategorizedView('all');
        else {
            const filtered = allProducts.filter(p => 
                p.name.toLowerCase().includes(val.toLowerCase()) || 
                (p.tags && p.tags.toLowerCase().includes(val.toLowerCase()))
            );
            renderSingleGrid(filtered, `"${val}" 的搜索结果`);
        }
        if (source === 'mobile') toggleMobileSearch(false);
    } else {
        if (val) window.location.href = `/?q=${encodeURIComponent(val)}`;
    }
}
document.addEventListener('keypress', (e) => {
    if((e.target.id === 'search-input' || e.target.id === 'mobile-search-input') && e.key === 'Enter') {
        doSearch(e.target.id === 'mobile-search-input' ? 'mobile' : 'pc');
    }
});

function togglePanel(panelId, overlayId, forceShow = null) {
    const panel = document.getElementById(panelId);
    const overlay = document.getElementById(overlayId);
    if(!panel || !overlay) return;
    const show = (forceShow === null) ? !panel.classList.contains('show') : forceShow;
    panel.classList.toggle('show', show);
    overlay.classList.toggle('show', show);
}
function toggleMobileSearch(forceShow = null) {
    const d = document.querySelector('.mobile-search-dropdown');
    const o = document.getElementById('mobile-search-overlay');
    if(!d || !o) return;
    const show = (forceShow === null) ? !d.classList.contains('show') : forceShow;
    d.classList.toggle('show', show);
    o.classList.toggle('show', show);
}
window.addEventListener('scroll', () => {
    if(document.querySelector('.mobile-search-dropdown.show')) toggleMobileSearch(false);
}, { passive: true });

function renderGlobalHeaders(config) {
    const siteName = config.site_name || '';
    const path = window.location.pathname;
    const isProductPage = path.includes('/product') && !path.includes('/products');
    const isArticleDetailPage = path.includes('/article') && !path.includes('/articles');
    // 如果不是商品详情和文章详情页，拼接店铺名称
    if (!isProductPage && !isArticleDetailPage) {
        let baseTitle = document.title.split('-')[0].trim();
        if (siteName) {
            document.title = baseTitle ? (baseTitle + '-' + siteName) : siteName;
        } else {
            document.title = baseTitle;
        }
    }
    const setText = (id, txt) => { const el = document.getElementById(id); if(el) el.innerText = txt; };
    setText('header-site-name', config.site_name);
    setText('mobile-header-site-name', config.site_name);
    const showName = config.show_site_name === '1';
    const showLogo = config.show_site_logo === '1';
    
    ['site-logo', 'mobile-logo-img'].forEach(id => {
        const el = document.getElementById(id);
        if(el && showLogo && config.site_logo) { el.src = config.site_logo; el.classList.remove('d-none'); }
    });
    ['site-name-wrap', 'mobile-site-name-wrap'].forEach(id => {
        const el = document.getElementById(id);
        if(el && (showName || (!showName && !showLogo))) el.classList.remove('d-none');
    });
    if (config.site_favicon) {
        let link = document.querySelector("link[rel~='icon']");
        if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link); }
        link.href = config.site_favicon;
    }
    const mobileLogoEl = document.getElementById('tb-mobile-sidebar-logo');
    if (mobileLogoEl) {
        if (config.mobile_sidebar_logo) {
            mobileLogoEl.src = config.mobile_sidebar_logo; 
            if (config.mobile_sidebar_logo_link) {
                mobileLogoEl.style.cursor = 'pointer';
                mobileLogoEl.onclick = function() { window.location.href = config.mobile_sidebar_logo_link; };
            } else {
                mobileLogoEl.style.cursor = 'default';
                mobileLogoEl.onclick = null;
            }
        } else {
            mobileLogoEl.src = '/assets/noimage.jpg';
            mobileLogoEl.style.cursor = 'default';
            mobileLogoEl.onclick = null;
        }
        mobileLogoEl.classList.remove('d-none'); 
    }
    if (config.custom_js) {
        const div = document.createElement('div');
        div.innerHTML = config.custom_js;
        Array.from(div.querySelectorAll('script')).forEach(oldScript => {
            const newScript = document.createElement('script');
            Array.from(oldScript.attributes).forEach(attr => newScript.setAttribute(attr.name, attr.value));
            newScript.appendChild(document.createTextNode(oldScript.innerHTML));
            document.body.appendChild(newScript);
        });
    }
}

function renderSidebarNoticeContact(config) {
    const setHtml = (id, html) => { const el = document.getElementById(id); if(el) el.innerHTML = html; };
    setHtml('notice-box', config.notice_content || config.announce || '暂无公告');
    
    const contact = config.contact_info || '<p>暂无联系方式</p>';
    setHtml('contact-box', contact);

    if (window.innerWidth < 992 && document.getElementById('products-list-area')) {
        const noticeModule = document.getElementById('notice-module-box');
        const mainContent = document.querySelector('.col-lg-9');
        if (noticeModule && mainContent) {
            mainContent.prepend(noticeModule);
            noticeModule.classList.remove('d-none');
        }
    }
}

function renderSidebarTopSales(allProducts) { 
    const el = document.getElementById('top-sales-list');
    if(!el || !allProducts) return;
    const list = [...allProducts].sort((a,b) => (b.variants[0]?.sales_count||0) - (a.variants[0]?.sales_count||0)).slice(0,5);
    el.innerHTML = list.length ? list.map(p => `
        <a href="/product?id=${p.id}" class="top-item">
            <img src="${p.image_url}" class="top-img">
            <div class="top-info"><div class="top-title">${p.name}</div><div class="top-price">¥${p.variants[0]?.price}</div></div>
        </a>`).join('') : '<div class="text-muted small text-center">暂无数据</div>';
}
function renderSidebarTagCloud(products) {
    const el = document.getElementById('tag-cloud-list');
    if(!el) return;
    const tags = new Set();
    products.forEach(p => (p.tags||'').split(',').forEach(t => {
        const clean = t.trim().split('#')[0].split(/\s+/)[0];
        if(clean && !clean.startsWith('b1') && !clean.startsWith('b2')) tags.add(clean);
    }));
    // === 修改点：统一绑定 onclick="handleTagClick(...)" ===
    el.innerHTML = tags.size ? Array.from(tags).map(t => 
        `<span class="tag-cloud-item" onclick="handleTagClick('${t}')">${t}</span>`
    ).join('') : '<div class="text-muted small text-center">暂无标签</div>';
}
function renderSidebarArticleCats(articles) {
    const el = document.getElementById('article-cat-list');
    if(el && articles?.length) {
        const cats = [...new Set(articles.map(a=>a.category_name).filter(Boolean))];
        el.innerHTML = cats.length ? cats.map(c=>`<a href="/articles?cat=${encodeURIComponent(c)}">${c}</a>`).join('') : '<div class="text-muted small">暂无分类</div>';
    }
}

function loadCartBadge() {
    try { updateCartBadge(JSON.parse(localStorage.getItem('tbShopCart') || '[]').length); } catch(e){}
}
function updateCartBadge(n) {
    ['cart-badge-mobile', 'cart-badge-pc', 'cart-badge-pc-product'].forEach(id => {
        const el = document.getElementById(id);
        if(el) { el.innerText = n > 99 ? '99+' : n; el.style.display = n > 0 ? 'block' : 'none'; }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    if(document.getElementById('back-to-top-btn')) return;
    const btn = document.createElement('div');
    btn.id = 'back-to-top-btn'; btn.className = 'back-to-top-btn'; btn.innerHTML = '<i class="fal fa-arrow-up"></i>';
    document.body.appendChild(btn);
    btn.onclick = () => window.scrollTo({top:0, behavior:'smooth'});
    window.onscroll = () => btn.classList.toggle('show', window.scrollY > 300);
});

/* 处理标签点击 */
function handleTagClick(tag) {
    if (typeof filterByTag === 'function') {
        // 首页：直接筛选
        filterByTag(tag);
    } else {
        // 非首页：跳转搜索
        window.location.href = '/?q=' + encodeURIComponent(tag);
    }
}
// === 极简版原生 JS 幻灯片组件 ===
document.addEventListener('DOMContentLoaded', () => {
    // 1. 注入极简 CSS 和 HTML 结构 (极细字体 font-weight:100)
    document.body.insertAdjacentHTML('beforeend', `<style>
    #xy-lb { display:none; position:fixed; z-index:999999; inset:0; background:rgba(0,0,0,.85); user-select:none; }
    #xy-lb.show { display:block; }
    #xy-lb-img { max-width:90%; max-height:90%; position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); box-shadow:0 4px 15px rgba(0,0,0,.5); }
    .xy-nav { position:absolute; color:rgba(255,255,255,.6); font-size:45px; cursor:pointer; font-weight:100; font-family:sans-serif; z-index:1000000; }
    .xy-nav:hover { color:#fff; }
    #xy-close { top:15px; right:25px; }
    #xy-prev { top:50%; left:15px; transform:translateY(-50%); }
    #xy-next { top:50%; right:15px; transform:translateY(-50%); }
    </style>
    <div id="xy-lb"><div id="xy-close" class="xy-nav">&times;</div><div id="xy-prev" class="xy-nav">&lt;</div><img id="xy-lb-img"><div id="xy-next" class="xy-nav">&gt;</div></div>`);

    let imgs = [], idx = 0;
    const lb = document.getElementById('xy-lb'), imgEl = document.getElementById('xy-lb-img');

    // 2. 全局点击事件委托（高度浓缩逻辑）
    document.body.addEventListener('click', e => {
        const t = e.target, cid = t.id;
        if (t.tagName === 'IMG' && t.closest('#article-content, #detail-left-content, #detail-right-content, #product-content') && !t.closest('.payment-option, .qr-popup')) {
            imgs = Array.from(t.closest('#article-content, #detail-left-content, #detail-right-content, #product-content').querySelectorAll('img')).filter(i => !i.closest('.payment-option, .qr-popup')).map(i => i.src);
            idx = imgs.indexOf(t.src);
            if (idx > -1) { imgEl.src = imgs[idx]; lb.classList.add('show'); }
        } else if (cid === 'xy-close' || cid === 'xy-lb') {
            lb.classList.remove('show'); // 点击关闭或背景
        } else if (cid === 'xy-prev' && imgs.length) {
            idx = idx > 0 ? idx - 1 : imgs.length - 1; imgEl.src = imgs[idx]; // 上一张
        } else if (cid === 'xy-next' && imgs.length) {
            idx = idx < imgs.length - 1 ? idx + 1 : 0; imgEl.src = imgs[idx]; // 下一张
        }
    });
});
