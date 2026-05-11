/* themes/default/files/header.js - 渲染页面头部（导航栏） */

/**
 * 渲染页头
 * @param {string} siteName - 网站名称
 * @param {string} siteLogo - 网站Logo地址 (可选)
 * @param {boolean|string} showSiteName - 是否显示网站名称 (true/'1' 显示, false/'0' 隐藏)
 */
   // 1. 将原渲染函数改名为纯骨架插入函数，移除传入参数
function insertHeaderSkeleton() {
    // 检查是否已渲染，防止重复
    if ($('header.custom-header').length > 0) return;
    
    // 使用固定的、带有ID的占位符，代替原先等待接口的动态变量
    const logoHtml = `<img src="" alt="Logo" class="site-logo global-site-logo-target" style="display:none;">`;
    const nameHtml = `<span class="global-site-name-target"></span>`;

    // 注入自定义 CSS 样式
    const styleHtml = `
        <style>
            /* 1. 页头容器样式 */
            header.custom-header {
                height: 60px; /* 要求：页头高度60px */
                background-color: #ffffff; /* 要求：页头颜色白色 */
                box-shadow: 0 2px 10px rgba(0,0,0,0.05);
                position: sticky;
                top: 0;
                z-index: 1030;
            }

            /* 2. Navbar 调整 */
            header.custom-header .navbar {
                height: 100%;
            }
            
            /* 3. 店铺名称样式 */
            header.custom-header .navbar-brand {
                font-size: 19px !important; /* 要求：字体 19px */
                font-weight: 600 !important; /* 要求：字重 600 */
                color: #333 !important;
                display: flex;
                align-items: center;
                margin-right: 20px;
            }
            header.custom-header .site-logo {
                height: 50px; /* 要求：Logo高度 47px */
                width: auto;
                margin-right: 10px;
                object-fit: contain;
            }

            /* 4. 菜单项样式 */
            header.custom-header .nav-link {
                font-size: 14px !important; /* 要求：其他字体 14px */
                color: #555 !important;
                display: flex;
                align-items: center;
                padding-left: 10px !important;
                padding-right: 12px !important;
                height: 60px; /* 垂直居中 */
                transition: color 0.2s;
                position: relative;
            }
            header.custom-header .nav-link:hover,
            header.custom-header .nav-link.active {
                color: var(--bs-primary) !important;
                background-color: rgba(0,0,0,0.02);
            }
            
            /* 5. 图标样式 */
            header.custom-header .nav-link i {
                margin-right: 6px;
                font-size: 14px;
                width: 16px;
                text-align: center;
            }

            /* 6. 搜索框样式 */
            .header-search-form {
                position: relative;
                margin-left: 15px;
            }
            .header-search-input {
                border-radius: 20px;
                font-size: 13px;
                padding: 5px 15px 5px 15px;
                border: 1px solid #eee;
                background-color: #f8f9fa;
                width: 200px;
                transition: all 0.3s;
                height: 34px;
            }
            .header-search-input:focus {
                background-color: #fff;
                border: 1px solid #555; /* 强制 1px 边框 */
                box-shadow: none;  /* 去掉浅蓝色光晕/外边框 */
                width: 240px;
                outline: none; /* 去掉浏览器默认的高亮轮廓 */
            }
            .header-search-icon {
                position: absolute;
                right: 11px;
                top: 50%;
                transform: translateY(-50%);
                color: #aaa;
                font-size: 14px;
                pointer-events: none;
            }

            /* 7. 下拉菜单样式 (鼠标移入向下滑出) */
            header.custom-header .dropdown-menu {
                visibility: hidden;
                opacity: 0;
                transform: translateY(-10px);
                transition: all 0.3s ease;
                display: block;
                margin-top: 0;
                border: none;
                box-shadow: 0 4px 12px rgba(0,0,0,0.1);
                border-radius: 4px;
                padding: 5px 0;
                min-width: 160px;
            }
            header.custom-header .nav-item.dropdown:hover .dropdown-menu {
                visibility: visible;
                opacity: 1;
                transform: translateY(0);
            }
            .category-toggle-wrap { display: flex; align-items: center; justify-content: space-between; width: 100%; }
            .category-arrow { 
                cursor: pointer; 
                color: #999;
            }
            .category-arrow i {
                transition: transform 0.3s ease;
                display: inline-block;
            }
            @media (min-width: 992px) {
                .category-arrow i { transform: rotate(90deg); }
                .nav-item.dropdown:hover .category-arrow i { transform: rotate(0deg); }
            }
            @media (max-width: 991px) {
                .category-arrow i { transform: rotate(0deg); }
                .category-arrow.active i { transform: rotate(90deg); }
            }
            header.custom-header .dropdown-item {
                font-size: 14px !important; 
                padding: 8px 15px;
                color: #555;
                display: flex;
                align-items: center;
            }
            header.custom-header .dropdown-item:hover {
                background-color: #f8f9fa;
                color: var(--bs-primary);
            }
            header.custom-header .category-icon-sm {
                width: 14px;  
                height: 14px; 
                object-fit: cover;
                margin-right: 5px;
                border-radius: 2px;
            }

            /* === 新增：购物车图标与角标样式 === */
            .header-cart-wrap {
                position: relative;
                margin-left: 15px;
                color: #6c757d; /* 灰色图标 */
                font-size: 18px;
                text-decoration: none;
                display: flex;
                align-items: center;
                cursor: pointer;
                transition: color 0.2s;
            }
            .header-cart-wrap:hover { color: #333; }
            
            .common-cart-badge {
                position: absolute;
                top: -8px;
                right: -10px;
                background-color: #dc3545; /* 红色背景 */
                color: #fff;               /* 白字 */
                border-radius: 50%;        /* 圆形 */
                font-size: 10px;
                min-width: 16px;
                height: 16px;
                line-height: 16px;
                text-align: center;
                padding: 1px 3px;
                display: none;             /* 默认隐藏 */
                box-shadow: 0 1px 2px rgba(0,0,0,0.2);
            }

            /* 移动端适配 */
            @media (max-width: 991px) {
                header.custom-header { height: auto; min-height: 52px; }
                header.custom-header .site-logo { height: 43px; } 
                header.custom-header .navbar-toggler { border: none; box-shadow: none; outline: none; padding: 8px 5px; }
                header.custom-header .navbar-toggler-icon { width: 1.3em; height: 1em; }
                /* --- 侧滑菜单样式 --- */
                header.custom-header .navbar-collapse {
                    position: fixed; top: 0; right: -280px; /* 默认隐藏在屏幕右侧外 */
                    width: 280px; height: 100vh; background-color: #fff;
                    box-shadow: -2px 0 10px rgba(0,0,0,0.1);
                    transition: right 0.3s ease; z-index: 1050;
                    padding: 0; display: block !important; /* 强制覆盖原本的隐藏属性 */
                    overflow-y: auto;
                }
                body.nav-open header.custom-header .navbar-collapse {
                    right: 0; /* JS触发时滑出 */
                }
                /* 侧边栏遮罩层 */
                #mobile-menu-overlay {
                    position: fixed; top: 0; left: 0; width: 100%; height: 100vh;
                    background: rgba(0,0,0,0.5); z-index: 1040;
                    opacity: 0; visibility: hidden; transition: all 0.3s ease;
                }
                body.nav-open #mobile-menu-overlay {
                    opacity: 1; visibility: visible;
                }
                /* --- 新增：移动端下滑搜索框容器样式 --- */
                .mobile-search-dropdown {
                   visibility: hidden; opacity: 0; transform: translateY(-10px); transition: all 0.3s ease;
                    position: absolute; top: 100%; left: 0; width: 100%; display: block;
                    background: #fff; padding: 12px 15px; box-shadow: 0 4px 8px rgba(0,0,0,0.08);
                    z-index: 1020; border-top: 1px solid #eee;
                }
                .mobile-search-dropdown.show { visibility: visible; opacity: 1; transform: translateY(0); }
                /* 菜单项样式重置 */
                header.custom-header .dropdown-item { display: block !important; width: 100%; box-sizing: border-box; padding-right: 15px !important; font-size: 13px !important; padding-top: 6px; padding-bottom: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
                header.custom-header .nav-link { display: block !important; width: 100%; box-sizing: border-box; line-height: 45px; padding-top: 0 !important; padding-bottom: 0 !important; height: 45px; border-bottom: 1px solid #f5f5f5; font-size: 13px !important; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
                header.custom-header .category-arrow { position: absolute; right: 0; top: 0; width: 45px; height: 45px; display: flex; align-items: center; justify-content: center; border-left: 1px solid #f5f5f5; }
                header.custom-header .category-toggle-wrap { padding-right: 45px !important; }
                header.custom-header .dropdown-menu {
                    position: static; box-shadow: none; border: none; padding-left: 3px; background: #fafafa;
                    display: none; visibility: visible; opacity: 1; transform: none; transition: none;
                }
                header.custom-header .dropdown-menu.show { display: block; }
            }
        </style>
    `;

    // 导航栏 HTML
    const headerHtml = `
        ${styleHtml}
        <header class="custom-header">
            <nav class="navbar navbar-expand-lg navbar-light">
                <div class="container d-flex justify-content-between align-items-center position-relative">
                    
                    <div class="d-lg-none m-0" style="width: auto; z-index: 1030;">
                        <i class="far fa-search" style="font-size: 19px; cursor: pointer; color: #555; padding: 5px;" onclick="$('#mobile-search-box').toggleClass('show');"></i>
                    </div>

                    <a class="navbar-brand d-none d-lg-flex" href="/">
                        ${logoHtml}
                        ${nameHtml}
                    </a>
                    <a class="navbar-brand d-lg-none position-absolute start-50 translate-middle-x m-0" href="/">
                        ${logoHtml}
                        ${nameHtml}
                    </a>

                    <div class="d-flex align-items-center d-lg-none ms-auto">
                        <button class="navbar-toggler" type="button" id="mobile-menu-btn">
                            <span class="navbar-toggler-icon"></span>
                        </button>
                    </div>

                    <button class="navbar-toggler d-none" type="button" data-bs-toggle="collapse" data-bs-target="#navbarNav">
                        <span class="navbar-toggler-icon"></span>
                    </button>

                    <div class="collapse navbar-collapse" id="navbarNav">
                        <div class="d-lg-none position-relative" style="padding: 0; border-bottom: none;">
                            <a id="mobile-sidebar-logo-link" style="display: block; text-decoration: none;">
                                <img src="/assets/noimage.jpg" class="global-mobile-sidebar-logo-target" style="width: 100%; max-height: 160px; object-fit: cover; display: block;" alt="侧栏背景">
                            </a>
                            <i class="fas fa-times" id="close-menu-btn" style="position: absolute; right: 15px; top: 15px; color: #555; background: rgba(255,255,255,0.8); width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 16px; cursor: pointer; z-index: 10;"></i>
                        </div>
                        <ul class="navbar-nav me-auto mb-2 mb-lg-0">
                            <li class="nav-item">
                                <a class="nav-link" href="/">
                                    <i class="fas fa-home"></i>商城首页
                                </a>
                            </li>
                           <li class="nav-item dropdown">
                                <div class="nav-link category-toggle-wrap">
                                    <a href="javascript:void(0);" onclick="handleCategoryClick('all')" style="color: red; text-decoration: none; flex: 1;">
                                        <i class="fas fa-list-ul"></i>商品分类
                                    </a>
                                    <span class="category-arrow" id="mobile-category-arrow">
                                        <i class="far fa-angle-right" style="margin-right: 0px;"></i>
                                    </span>
                                </div>
                                <ul class="dropdown-menu" aria-labelledby="categoryDropdown" id="header-category-menu">
                                    <li><span class="dropdown-item text-muted">加载中...</span></li>
                                </ul>
                            </li>

                            <li class="nav-item">
                                <a class="nav-link" href="orders">
                                    <i class="fas fa-search"></i>订单查询
                                </a>
                            </li>
                           <li class="nav-item dropdown">
                                <div class="nav-link category-toggle-wrap">
                                    <a href="articles" style="color: inherit; text-decoration: none; flex: 1;">
                                        <i class="fas fa-book-open"></i>文章中心
                                    </a>
                                    <span class="category-arrow" id="mobile-article-category-arrow">
                                        <i class="far fa-angle-right" style="margin-right: 0px;"></i>
                                    </span>
                                </div>
                                <ul class="dropdown-menu" aria-labelledby="articleCategoryDropdown" id="header-article-category-menu">
                                    <li><span class="dropdown-item text-muted">加载中...</span></li>
                                </ul>
                            </li>
                            <li class="nav-item">
                                <a class="nav-link" href="custom?alias=about-us" target="_blank" rel="noopener noreferrer">
                                    <i class="fas fa-info-circle"></i>关于我们
                                </a>
                            </li>
                        </ul>

                        <div class="header-search-form d-none d-lg-block">
                            <i class="far fa-search header-search-icon"></i>
                            <input type="text" class="header-search-input" id="top-search-input" placeholder="搜索商品...">
                        </div>

                        <a href="/cart" class="header-cart-wrap d-none d-lg-block" title="购物车">
                            <i class="far fa-shopping-cart"></i>
                            <span class="common-cart-badge" id="header-cart-badge">0</span>
                        </a>

                    </div>
                    <div class="mobile-search-dropdown d-lg-none" id="mobile-search-box">
                        <div style="display: flex; border: 1px solid #ddd; border-radius: 20px; overflow: hidden; background: #fff; width: 100%;">
                            <input type="text" class="header-search-input" placeholder="搜索商品..." style="padding: 6px 15px; border: none; outline: none; font-size: 14px; flex-grow: 1; height: 36px; background: transparent; box-shadow: none;">
                            <button onclick="const e = $.Event('keypress'); e.which = 13; $(this).prev('input').trigger(e);" style="padding: 0 20px; background: var(--bs-primary); color: #fff; border: none; cursor: pointer; font-size: 14px; height: 36px; white-space: nowrap;">搜索</button>
                        </div>
                    </div>
                </div>
            </nav>
            <div id="mobile-menu-overlay"></div>
        </header>
    `;
    
    $('body').prepend(headerHtml);
    
    const currentPath = window.location.pathname.split('/').pop() || '/';
    $('.nav-link').removeClass('active');
    
    if (currentPath === '' || currentPath === '/') {
        $('a[href="/"]').first().addClass('active');
    } else {
        $(`a[href="${currentPath}"]`).addClass('active');
    }
      loadHeaderCategories();
      loadArticleCategories(); 
    // 初始化购物车角标
    if (typeof updateCartBadge === 'function') {
        updateCartBadge();
    }

    $('.header-search-input').on('keypress', function(e) {
        if (e.which == 13) {
            const kw = $(this).val().trim().toLowerCase();
            if (!kw) return;

            if (window.location.pathname.endsWith('/') || window.location.pathname === '/') {
                let found = 0;
                $('.product-card-item').each(function() {
                    const text = $(this).text().toLowerCase();
                    if (text.includes(kw)) {
                        $(this).show();
                        $(this).closest('.col-12').show(); // 确保显示商品所在列
                        found++;
                    } else {
                        $(this).hide();
                        $(this).closest('.col-12').hide(); // 隐藏商品所在列
                    }
                });

                // 新增：遍历所有分类大框，如果没有可见商品则隐藏整个框
                $('#goods-container .main-box').each(function() {
                    const hasVisible = $(this).find('.product-card-item:visible').length > 0;
                    if (hasVisible) {
                        $(this).show();
                    } else {
                        $(this).hide();
                    }
                });
                if (found === 0) {
                    alert('未找到包含 "' + kw + '" 的商品');
                    $('.product-card-item').show();
                } else {
                    $('html, body').animate({
                        scrollTop: $("#product-list").offset().top - 80
                    }, 500);
                }
            } else {
                window.location.href = '/?search=' + encodeURIComponent(kw);
            }
        }
    });
    // 新增：移动端侧滑菜单交互逻辑
    const menuBtn = $('#mobile-menu-btn');
    const closeBtn = $('#close-menu-btn');
    const overlay = $('#mobile-menu-overlay');
    const body = $('body');

    menuBtn.on('click', function(e) {
        e.stopPropagation();
        body.addClass('nav-open');
    });

    closeBtn.add(overlay).on('click', function() {
        body.removeClass('nav-open');
    });

    $('#navbarNav').on('click', function(e) {
        e.stopPropagation(); 
    });
    $('#mobile-category-arrow').on('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        
        // 切换箭头自身的 active 状态触发旋转
        $(this).toggleClass('active');
        
        const menu = $('#header-category-menu');
        menu.toggleClass('show');
    });
   $('#mobile-article-category-arrow').on('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        $(this).toggleClass('active');
        const menu = $('#header-article-category-menu');
        menu.toggleClass('show');
    });
    $('#navbarNav').on('click', 'a', function() {
        $('body').removeClass('nav-open');
    });
    $(document).on('click', function(e) {
        const searchBox = $('#mobile-search-box');
            if ($(e.target).closest('i[onclick*="toggleClass"]').length > 0) {
                return;
            }
            if (searchBox.hasClass('show') && $(e.target).closest('#mobile-search-box').length === 0) {
                searchBox.removeClass('show');
            }
        });
        $(window).on('scroll', function() {
            const searchBox = $('#mobile-search-box');
            if (searchBox.hasClass('show')) {
                searchBox.removeClass('show');
                searchBox.find('input').blur();
            }
    });
   // === 新增：移动端默认展开“商品分类” ===
    if ($(window).width() <= 991) {
        $('#mobile-category-arrow').addClass('active');
        $('#header-category-menu').addClass('show');
    }
}
/**
 * 加载分类并渲染到下拉菜单
 */
function loadHeaderCategories() {
    $.ajax({
        url: '/api/shop/categories',
        method: 'GET',
        success: function(response) {
            let categories = [];
            if (response && response.code === 0 && response.data && Array.isArray(response.data.categories)) {
                categories = response.data.categories;
            } else if (response && (Array.isArray(response) || Array.isArray(response.categories))) {
                categories = Array.isArray(response) ? response : response.categories;
            } else if (response && response.results && Array.isArray(response.results)) {
                 categories = response.results;
            }

            const menuContainer = $('#header-category-menu');
            menuContainer.empty();

            if (categories.length === 0) {
                menuContainer.append('<li><span class="dropdown-item text-muted">暂无分类</span></li>');
                return;
            }

            categories.forEach(cat => {
                const imgHtml = (cat.image_url && cat.image_url !== '') 
                    ? `<img src="${cat.image_url}" class="category-icon-sm" alt="icon">` 
                    : '';
               const itemHtml = `
                    <li>
                        <a class="dropdown-item" href="javascript:void(0);" onclick="handleCategoryClick('${cat.id}')">
                            ${imgHtml}${cat.name}
                        </a>
                    </li>
                `;
                menuContainer.append(itemHtml);
            });
        },
        error: function() {
            $('#header-category-menu').html('<li><span class="dropdown-item text-danger">加载失败</span></li>');
        }
    });
}

// 全局分类点击处理
window.handleCategoryClick = function(catId) {
    if (typeof loadProducts === 'function' && $('#goods-container').length > 0) {
        loadProducts(catId);
        if ($('#category-list').length > 0) {
             $('#category-list button').removeClass('btn-primary shadow-sm').addClass('btn-light text-dark');
                     $('#category-list button').filter(function() { return String($(this).data('id')) === String(catId); }).removeClass('btn-light text-dark').addClass('btn-primary shadow-sm');
        }
        $('html, body').animate({ scrollTop: $("#goods-container").offset().top - 100 }, 300);
    } else {
        window.location.href = '/?category_id=' + catId;
    }
};
/**
 * 加载文章分类并渲染到下拉菜单
 */
function loadArticleCategories() {
    $.ajax({
        url: '/api/shop/article/categories',
        method: 'GET',
        success: function(response) {
            let categories = [];
            // 处理不同的返回格式
            if (response && Array.isArray(response)) {
                categories = response;
            } else if (response && response.results && Array.isArray(response.results)) {
                 categories = response.results;
            }

            const menuContainer = $('#header-article-category-menu');
            menuContainer.empty();

            if (categories.length === 0) {
                menuContainer.append('<li><span class="dropdown-item text-muted">暂无分类</span></li>');
                return;
            }

            categories.forEach(cat => {
                const itemHtml = `
                    <li>
                        <a class="dropdown-item" href="/articles?category_id=${cat.id}">
                            ${cat.name}
                        </a>
                    </li>
                `;
                menuContainer.append(itemHtml);
            });
        },
        error: function() {
            $('#header-article-category-menu').html('<li><span class="dropdown-item text-danger">加载失败</span></li>');
        }
    });
}
/**
 * 全局函数：更新购物车角标
 * 读取 localStorage 中的 tbShopCart
 */
window.updateCartBadge = function() {
    try {
        const cartStr = localStorage.getItem('tbShopCart');
        const cart = cartStr ? JSON.parse(cartStr) : [];
        const count = cart.length; // 根据需求，显示商品种数（或者 quantity 之和）

        const badgeDisplay = count > 0 ? 'block' : 'none';
        const badgeText = count > 99 ? '99+' : count;

        // 更新页头角标
        const headerBadge = $('#header-cart-badge');
        if(headerBadge.length) {
            headerBadge.text(badgeText).css('display', badgeDisplay);
        }
        
        // 更新详情页角标（如果在详情页）
        const prodBadge = $('#product-page-cart-badge');
        if(prodBadge.length) {
            prodBadge.text(badgeText).css('display', badgeDisplay);
        }
    } catch(e) {
        console.error('Update cart badge failed:', e);
            }
        }
        $(document).ready(function() {
            insertHeaderSkeleton();
            $.get('/api/shop/config', function(res) {
                if (res.site_favicon) {
                    $('head').append('<link rel="shortcut icon" href="' + res.site_favicon + '">');
                }
                if (res.mobile_sidebar_logo) {
                    $('.global-mobile-sidebar-logo-target').attr('src', res.mobile_sidebar_logo);
                }
                if (res.mobile_sidebar_logo_link) {
                    $('#mobile-sidebar-logo-link').attr('href', res.mobile_sidebar_logo_link);
                }
                if(typeof window.renderHeader === 'function') { window.renderHeader(res.site_name, res.site_logo, res.show_site_name); }
            });
        });
        // 3. 重写暴露给外部的 renderHeader 函数：使其仅负责后台配置返回后填充文字和图片
        window.renderHeader = function(siteName = 'XYRJ夏雨发卡', siteLogo = '', showSiteName = true) {
    insertHeaderSkeleton();
    const shouldShowName = (showSiteName == '1' || showSiteName === true);
    if (siteLogo) {
        $('.global-site-logo-target').attr('src', siteLogo).show();
    } else {
        $('.global-site-logo-target').hide();
    }
    if (shouldShowName) {
        $('.global-site-name-target').text(siteName).show();
    } else {
        $('.global-site-name-target').hide();
    }
    const path = window.location.pathname;
    const isProductPage = path.includes('/product') && !path.includes('/products');
    const isArticleDetailPage = path.includes('/article') && !path.includes('/articles');
    if (!isProductPage && !isArticleDetailPage) {
        let baseTitle = document.title.split('-')[0].trim();
        if (baseTitle) {
            document.title = baseTitle + '-' + siteName;
        }
    }
};
