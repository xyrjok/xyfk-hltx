let cart=[],isEditing=!1,cartPaymentMethod="";function syncInputs(t,e){const n=document.getElementById(t),a=document.getElementById(e);n&&a&&(n.addEventListener("input",t=>a.value=t.target.value),a.addEventListener("input",t=>n.value=t.target.value))}function normalizeItem(t){return{productId:t.product_id||t.productId||t.product_id,variantId:t.variant_id||t.variantId,productName:t.productName||t.name||t.title||"未命名商品",variantName:t.variant_name||t.variantName||t.skuName||t.variant||"默认规格",selectedCardId:t.selectedCardId||null,name:t.productName||t.name||t.title||"未命名商品",sku:t.variant_name||t.variantName||t.skuName||t.variant||"默认规格",img:t.img||t.image||t.thumb||t.pic||"/themes/TBshop/assets/no-image.png",price:parseFloat(t.price||0),quantity:parseInt(t.quantity||1),buyMode:t.buyMode||"auto",inputData:t.selectedCardInfo||t.selectedCardNote||t.input_data||t.customInfo||"",checked:!1!==t.checked}}function selectCartPayment(t,e){cartPaymentMethod=t,["cart-payment-list-pc","cart-payment-list-mobile"].forEach(e=>{const n=document.getElementById(e);if(!n)return;n.querySelectorAll(".payment-option").forEach(t=>t.classList.remove("active"));const a=n.querySelector(`.payment-option[data-method="${t}"]`);a&&a.classList.add("active")})}function loadCart(){try{cart=JSON.parse(localStorage.getItem("tbShopCart")||"[]")}catch(t){cart=[]}const t=document.getElementById("cart-list-mobile"),e=document.getElementById("cart-list-pc");0===cart.length?(t&&(t.innerHTML='<div class="text-center p-5 text-muted">购物车空空如也</div>'),e&&(e.innerHTML='<tr><td colspan="6" class="text-center p-5 text-muted">购物车空空如也</td></tr>')):(t&&(t.innerHTML=cart.map((t,e)=>renderMobileItem(t,e)).join("")),e&&(e.innerHTML=cart.map((t,e)=>renderPCItem(t,e)).join(""))),"function"==typeof updateCartBadge&&updateCartBadge(cart.length);const n=document.getElementById("cart-count-mobile");n&&(n.innerText=cart.length),updateTotal()}function renderPCItem(t,e){const n=normalizeItem(t),a=(n.price*n.quantity).toFixed(2),o=`<span class="text-muted">${n.sku}</span>`,c=n.productId?`/product?id=${n.productId}`:"javascript:void(0)";let r="";return"select"===n.buyMode?r=n.inputData?`<span class="text-danger ms-1">[已选: ${n.inputData}]</span>`:'<span class="text-danger ms-1">[未选号码]</span>':"random"===n.buyMode&&(r='<span class="text-danger ms-1">[随机发货]</span>'),`\n    <tr>\n        <td class="ps-3">\n            <input class="form-check-input cart-item-check-input" type="checkbox" onchange="toggleItemCheck(${e}, this)" ${n.checked?"checked":""}>\n        </td>\n        <td>\n            <div class="d-flex align-items-center">\n                <a href="${c}" target="_blank" class="d-block me-2">\n                    <img src="${n.img}" class="pc-item-img" alt="img" \n                         onerror="this.src='/themes/TBshop/assets/no-image.png'" \n                         style="width:48px;height:48px;object-fit:cover;border-radius:4px;border:1px solid #eee;">\n                </a>\n                <div>\n                    <a href="${c}" target="_blank" class="pc-cart-title text-dark text-decoration-none d-block" style="font-size:13px; font-weight:500;">\n                        ${n.name}\n                    </a>\n                    <div class="pc-cart-sku small" style="font-size:12px; color:#888;">\n                        ${o}${r}\n                    </div>\n                </div>\n            </div>\n        </td>\n        <td class="text-muted" style="font-size:13px;">¥${n.price.toFixed(2)}</td>\n        <td>\n            <div class="stepper" style="width:90px; height:26px; border:1px solid #ddd; display:flex; border-radius:3px;">\n                <button type="button" class="stepper-btn minus d-flex align-items-center justify-content-center bg-light border-0" \n                     onclick="changeQty(${e}, -1)" style="width:26px; cursor:pointer; border-right:1px solid #ddd !important;">-</button>\n                <input type="number" class="stepper-input text-center border-0" value="${n.quantity}" \n                       onchange="changeQty(${e}, 0, this.value)" style="width:36px; font-size:13px; outline:none;">\n                <button type="button" class="stepper-btn plus d-flex align-items-center justify-content-center bg-light border-0" \n                     onclick="changeQty(${e}, 1)" style="width:26px; cursor:pointer; border-left:1px solid #ddd !important;">+</button>\n            </div>\n        </td>\n        <td><strong class="text-danger small">¥${a}</strong></td>\n        <td>\n            <a href="javascript:void(0)" class="text-muted small text-decoration-none" onclick="deleteItem(${e})">\n                <i class="fa fa-trash-alt"></i>\n            </a>\n        </td>\n    </tr>`}function renderMobileItem(t,e){const n=normalizeItem(t),a=n.productId?`/product?id=${n.productId}`:"javascript:void(0)";let o="";return o="select"===n.buyMode?n.inputData?`已选: ${n.inputData}`:"未选号码":"随机发货",`\n    <div class="cart-item bg-white p-3 mb-2 rounded shadow-sm position-relative">\n        <div class="d-flex">\n            <div class="me-2 d-flex align-items-center">\n                <input class="form-check-input cart-item-check-input" type="checkbox" onchange="toggleItemCheck(${e}, this)" ${n.checked?"checked":""}>\n            </div>\n            \n            <a href="${a}" class="d-block me-2">\n                <img src="${n.img}" class="rounded" alt="img" \n                     onerror="this.src='/themes/TBshop/assets/no-image.png'"\n                     style="width:70px; height:70px; object-fit:cover; border:1px solid #f0f0f0;">\n            </a>\n\n            <div class="flex-grow-1">\n                <a href="${a}" class="text-truncate mb-1 text-dark text-decoration-none d-block" style="font-size:14px; font-weight:bold; max-width:200px;">\n                    ${n.name}\n                </a>\n                <div class="small text-muted bg-light px-2 py-1 rounded d-inline-block mb-2" style="font-size:12px;">\n                    ${n.sku} <span class="text-danger">(${o})</span>\n                </div>\n                <div class="d-flex justify-content-between align-items-end">\n                    <div class="text-danger fw-bold">¥${n.price.toFixed(2)}</div>\n                    \n                    <div class="stepper d-flex border rounded" style="height:24px; width: auto !important;">\n                        <button type="button" class="stepper-btn minus px-2 d-flex align-items-center bg-light cursor-pointer border-0" \n                                onclick="changeQty(${e}, -1)" style="min-width: 28px;">-</button>\n                        <input type="number" class="stepper-input text-center border-0 border-start border-end" value="${n.quantity}" \n                               onchange="changeQty(${e}, 0, this.value)" style="width:30px; font-size:12px; outline:none;">\n                        <button type="button" class="stepper-btn plus px-2 d-flex align-items-center bg-light cursor-pointer border-0" \n                                onclick="changeQty(${e}, 1)" style="min-width: 28px;">+</button>\n                    </div>\n\n                </div>\n            </div>\n        </div>\n        <button class="btn btn-sm text-muted position-absolute top-0 end-0 mt-2 me-2" \n                onclick="deleteItem(${e})" style="display:${isEditing?"block":"none"}">\n            <i class="fa fa-times"></i>\n        </button>\n    </div>`}function toggleItemCheck(t,e){cart[t]&&(cart[t].checked=e.checked,updateTotal())}function toggleEdit(){isEditing=!isEditing;const t=document.getElementById("edit-btn-mobile");t&&(t.innerText=isEditing?"完成":"管理"),loadCart()}function updateTotal(){let t=0,e=0,n=cart.length>0;cart.forEach(a=>{if(!1!==a.checked){const n=parseFloat(a.price)||0,o=parseInt(a.quantity)||1;t+=n*o,e++}else n=!1}),["check-all-pc","check-all-mobile-footer"].forEach(t=>{const e=document.getElementById(t);e&&(e.checked=n)}),[{t:"total-price-pc",c:"checkout-count-pc"},{t:"total-price-mobile",c:"checkout-count-mobile"}].forEach(n=>{const a=document.getElementById(n.t),o=document.getElementById(n.c);a&&(a.innerText=t.toFixed(2)),o&&(o.innerText=e)}),localStorage.setItem("tbShopCart",JSON.stringify(cart)),"function"==typeof window._renderMemberEstimate&&window._renderMemberEstimate()}async function loadCartGateways(){try{const t=await fetch("/api/shop/gateways"),e=await t.json(),n=["cart-payment-list-pc","cart-payment-list-mobile"];if(!e||0===e.length)return;cartPaymentMethod=e[0].id;const a=e.map((t,e)=>{const n=0===e?"active":"";let a='<i class="fas fa-credit-card"></i>';return a=t.icon?`<img src="${t.icon}" style="width:20px; height:20px; object-fit:contain;"> <span style="font-size:13px; font-weight:bold; margin-left:4px;">${t.name}</span>`:`<i class="fas fa-credit-card" style="color:#1678ff;"></i> <span style="font-size:13px; font-weight:bold; margin-left:4px;">${t.name}</span>`,`<div class="payment-option ${n}" data-method="${t.id}" onclick="selectCartPayment('${t.id}', this)" title="${t.name}">\n                        ${a}<div class="payment-check-mark"><i class="fa fa-check"></i></div>\n                    </div>`}).join("");n.forEach(t=>{const e=document.getElementById(t);e&&(e.innerHTML=a)});
                // 会员余额支付选项
                if(localStorage.getItem('member_token')){
                    n.forEach(listId=>{
                        const list=document.getElementById(listId);
                        if(!list)return;
                        const bp=document.createElement('div');bp.className='payment-option';bp.setAttribute('onclick',"selectCartPayment('balance',this)");bp.setAttribute('data-method','balance');bp.title='余额支付';bp.innerHTML='<i class="fas fa-wallet" style="color:#1678ff;"></i> <span style="font-size:13px; font-weight:900; margin-left:4px;">余额支付</span><div class="payment-check-mark"><i class="fa fa-check"></i></div>';list.appendChild(bp);
                    });
                }}catch(t){}}document.addEventListener("DOMContentLoaded",async()=>{loadCart();const t=localStorage.getItem("userContact"),e=localStorage.getItem("userPassword"),isMember=!!localStorage.getItem('member_token');if(isMember){["contact-info","contact-info-mobile","query-password","query-password-mobile"].forEach(id=>{const el=document.getElementById(id);if(el){const wrap=el.closest('.mb-3')||el.closest('.col-12')||el.closest('.input-group');if(wrap)wrap.style.setProperty('display','none','important')}})}t&&[document.getElementById("contact-info"),document.getElementById("contact-info-mobile")].forEach(e=>{e&&(e.value=t)}),e&&[document.getElementById("query-password"),document.getElementById("query-password-mobile")].forEach(t=>{t&&(t.value=e)}),syncInputs("contact-info","contact-info-mobile"),syncInputs("query-password","query-password-mobile"),loadCartGateways()}),window.toggleCheckAll=function(t){const e=t.checked;cart.forEach(t=>t.checked=e),localStorage.setItem("tbShopCart",JSON.stringify(cart)),loadCart()},window.changeQty=function(t,e,n=null){if(!cart[t])return;if("select"===cart[t].buyMode&&(parseInt(cart[t].quantity),e>0||null!==n&&parseInt(n)>1))return alert("提示：该商品为加价自选，每组预设信息只能购买一份。\n如需购买多份，请返回商品页选择其他号码/预设信息。"),void(null!==n&&(cart[t].quantity=1,localStorage.setItem("tbShopCart",JSON.stringify(cart)),loadCart()));let a=parseInt(cart[t].quantity)||1;null!==n?a=parseInt(n):a+=e,(isNaN(a)||a<1)&&(a=1),cart[t].quantity=a,localStorage.setItem("tbShopCart",JSON.stringify(cart)),loadCart()},window.deleteItem=function(t){confirm("确定删除该商品吗？")&&(cart.splice(t,1),localStorage.setItem("tbShopCart",JSON.stringify(cart)),loadCart())},window.handleCheckout=async function(){const t=cart.filter(t=>!1!==t.checked);if(0===t.length)return alert("请选择要结算的商品");const isMember=!!localStorage.getItem('member_token');const e=document.getElementById("contact-info").value.trim()||document.getElementById("contact-info-mobile").value.trim(),n=document.getElementById("query-password").value.trim()||document.getElementById("query-password-mobile").value.trim();if(!isMember){if(!e)return alert("请输入联系方式");if(!n)return alert("请输入查单密码");if(n.length<3)return alert("查单密码不能少于3位")}localStorage.setItem("userContact",e),localStorage.setItem("userPassword",n);const a=document.querySelectorAll('button[onclick="handleCheckout()"]');a.forEach(t=>{t.disabled=!0,t.innerText="提交中..."});try{const reqBody={items:t.map(normalizeItem),contact:e,query_password:n,payment_method:cartPaymentMethod},o=await fetch("/api/shop/cart/checkout",{method:"POST",headers:Object.assign({"Content-Type":"application/json"},isMember?{"Authorization":"Bearer "+localStorage.getItem("member_token")}:{}),body:JSON.stringify(reqBody)}),c=await o.json();if(c.error){if(c.error.includes("未支付订单")&&confirm("提示："+c.error+'\n\n点击"确定"前往查单页面处理。'))return void(window.location.href="/orders");throw new Error(c.error)}localStorage.setItem("tbShopCartChecked",JSON.stringify(t));
                if(cartPaymentMethod==='balance'){
                    const token=localStorage.getItem('member_token');
                    if(!token){alert('请先登录会员');window.location.href='/member/login';return}
                    try{
                        const payRes=await fetch('/api/member/balance_pay',{method:'POST',headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({order_id:c.order_id})});
                        const payData=await payRes.json();
                        if(payData.error){alert(payData.error);a.forEach(t=>{t.disabled=!1;t.innerText='立即结算'});return}
                        let msg='支付成功！余额：¥'+payData.balance.toFixed(2);
                        if(c.discount){msg+='\n🎉 会员折扣已生效，原价 ¥'+Number(c.discount.original_price).toFixed(2)+'，实付 ¥'+Number(c.total_amount).toFixed(2)}
                        try{const ck=JSON.parse(localStorage.getItem('tbShopCartChecked')||'[]');if(ck.length>0){let c2=JSON.parse(localStorage.getItem('tbShopCart')||'[]');const ks=new Set(ck.map(i=>(i.productId||i.product_id)+'_'+(i.variantId||i.variant_id)));c2=c2.filter(i=>!ks.has((i.productId||i.product_id)+'_'+(i.variantId||i.variant_id)));localStorage.setItem('tbShopCart',JSON.stringify(c2))}localStorage.removeItem('tbShopCartChecked')}catch(e){localStorage.removeItem('tbShopCartChecked')}
                        showCartCards(payData.cards||[],msg);
                    }catch(e){alert('余额支付请求失败');a.forEach(t=>{t.disabled=!1;t.innerText='立即结算'});}
                }else{window.location.href=`pay?order_id=${c.order_id}&method=${cartPaymentMethod}`}
                }catch(t){alert("结算失败: "+t.message),a.forEach(t=>{t.disabled=!1,t.innerText="立即结算"})}};
// === 会员余额支付支持 (购物车) ===
(function() {
    const token = localStorage.getItem('member_token');
    if (!token) return;
    // 显示会员折扣信息 + 会员预计支付
    // [修复] 原实现依赖 config.member_discount（/api/shop/config 不公开该键）且挂在不存在的容器
    // (.total-area/.cart-total-box/.checkout-area) 上，提示从未生效；且未感知商品级"会员价"开关。
    // 现改为：按会员等级折扣 + 商品开关，逐项与后端 /api/shop/cart/checkout 同口径计算实际应付金额。
    window._cartMemberDiscount = 0;
    window._cartMemberPriceMap = {};
    window._cartVariantMap = {};
    window._renderMemberEstimate = function() {
        document.querySelectorAll('.member-cart-hint').forEach(el => el.remove());
        const d = window._cartMemberDiscount || 0;
        if (!d) return;
        const pmap = window._cartMemberPriceMap || {};
        const vmap = window._cartVariantMap || {};
        const items = (cart || []).filter(i => i.checked !== false);
        if (items.length === 0) return;
        let total = 0, discountedCnt = 0, plainCnt = 0;
        items.forEach(it => {
            const pid = it.product_id || it.productId;
            const qty = parseInt(it.quantity) || 1;
            const v = vmap[it.variant_id || it.variantId] || null;
            // 与后端同口径计算单价：自选加价 / 批发价（随机模式）
            let unit = v ? (parseFloat(v.price) || 0) : (parseFloat(it.price) || 0);
            if (it.buyMode === 'select' && it.selectedCardId && v) {
                unit += parseFloat(v.custom_markup || 0);
            } else if (v && v.wholesale_config) {
                let wc = v.wholesale_config;
                try { if (typeof wc === 'string') wc = JSON.parse(wc); } catch(e) { wc = null; }
                if (Array.isArray(wc)) {
                    const rules = wc.map(r => ({ qty: parseInt(r.qty || r.count || r.num || r.number || 0), price: parseFloat(r.price || r.amount || 0) }))
                        .filter(r => r.qty > 0 && r.price > 0)
                        .sort((a, b) => b.qty - a.qty);
                    const hit = rules.find(r => qty >= r.qty);
                    if (hit) unit = hit.price;
                }
            }
            const on = pmap[pid] !== false; // 无商品信息时视为开启（与后端一致）
            if (on) { total += Math.round(unit * d / 100 * 100) / 100 * qty; discountedCnt++; }
            else { total += unit * qty; plainCnt++; }
        });
        const parts = [];
        if (discountedCnt > 0) parts.push('会员专享 ' + (d / 10) + ' 折，结算时自动生效');
        if (plainCnt > 0) parts.push(plainCnt + ' 件商品未开启会员价，按原价结算');
        parts.push('会员预计支付 <b>¥' + total.toFixed(2) + '</b>');
        // 挂到合计区域（PC + 移动端各一份）
        const anchors = [];
        const pc = document.getElementById('total-price-pc');
        if (pc) anchors.push({ row: pc.closest('.d-flex') || pc.parentNode, mode: 'after' });
        const mb = document.getElementById('total-price-mobile');
        if (mb) anchors.push({ row: mb.parentNode, mode: 'append' });
        anchors.forEach((a, idx) => {
            const hint = document.createElement('div');
            hint.className = 'member-cart-hint';
            hint.id = idx === 0 ? 'member-discount-hint' : 'member-discount-hint-m';
            hint.style.cssText = 'margin-top:6px; padding:5px 8px; background:linear-gradient(135deg,#fff3cd,#ffeaa7); border-radius:4px; font-size:12px; color:#856404; line-height:1.5;';
            hint.innerHTML = '<i class="fas fa-crown me-1" style="color:#f39c12;"></i>' + parts.join('｜');
            if (a.mode === 'after') a.row.insertAdjacentElement('afterend', hint);
            else a.row.appendChild(hint);
        });
    };
    Promise.all([
        fetch('/api/shop/config').then(r=>r.json()).catch(()=>({})),
        fetch('/api/member/profile', { headers: { 'Authorization': '***' + token } }).then(r=>r.json()).catch(()=>({})),
        fetch('/api/shop/products').then(r=>r.json()).catch(()=>[])
    ]).then(([config, prof, prods]) => {
        try {
            if (config && config.member_enabled === '1') {
                const levels = JSON.parse(config.member_levels || '[]');
                const lvl = (prof && prof.user && parseInt(prof.user.member_level)) || 0;
                if (Array.isArray(levels) && levels[lvl] && levels[lvl].discount) {
                    const d = parseInt(levels[lvl].discount);
                    if (d >= 1 && d < 100) window._cartMemberDiscount = d;
                }
            }
        } catch(e) {}
        try {
            (Array.isArray(prods) ? prods : []).forEach(p => {
                window._cartMemberPriceMap[p.id] = p.member_price_enabled !== 0;
                (p.variants || []).forEach(v => { window._cartVariantMap[v.id] = v; });
            });
        } catch(e) {}
        window._renderMemberEstimate();
    }).catch(()=>{});
    // 余额支付已集成到支付方式列表中，无需单独注入按钮

    // [补充] 显示会员余额（与商品页 member-balance-info 保持一致）
    fetch('/api/member/profile', { headers: { 'Authorization': 'Bearer ' + token } })
        .then(r => r.json())
        .then(data => {
            if (!data.user) return;
            const balance = parseFloat(data.user.balance || 0);
            ['cart-payment-list-pc', 'cart-payment-list-mobile'].forEach(id => {
                const payArea = document.getElementById(id);
                if (!payArea || document.getElementById('member-balance-info-' + id)) return;
                const info = document.createElement('div');
                info.id = 'member-balance-info-' + id;
                info.style.cssText = 'width:100%; margin-bottom:8px; padding:6px 10px; background:#e8f4fd; border-radius:6px; font-size:13px; color:#0c5460; display:flex; align-items:center; justify-content:space-between;';
                info.innerHTML = '<span><i class="fas fa-wallet me-1" style="color:#1678ff;"></i>会员余额: <b style="color:#dc3545;">¥' + balance.toFixed(2) + '</b></span><a href="/member" style="font-size:12px; color:#1678ff;">充值</a>';
                payArea.parentNode.insertBefore(info, payArea);
            });
        })
        .catch(()=>{});
})();

// === showCartCards: 余额支付成功后展示卡密信息 ===
window.showCartCards = function(cards, msg) {
    // 构建卡密展示 HTML
    let cardsHtml = '';
    let cardsArray = [];
    if (cards) {
        if (Array.isArray(cards)) {
            cardsArray = cards;
        } else if (typeof cards === 'string') {
            try { cardsArray = JSON.parse(cards); } catch(e) { cardsArray = [cards]; }
        }
    }
    let processedCards = [];
    let rawCards = [];
    cardsArray.forEach(item => {
        if (typeof item === 'string' && item.trim() !== '') {
            processedCards.push(item);
            rawCards.push(item);
        } else if (typeof item === 'object' && item !== null) {
            if (Array.isArray(item.cards) && item.cards.length > 0) {
                item.cards.forEach(c => {
                    processedCards.push('[' + (item.productName || item.variantName || '') + '] ' + c);
                    rawCards.push(c);
                });
            }
        }
    });

    // [复制按钮] 降级保护：common.js 未加载完成时不渲染按钮，保持原样展示
    const XY = window.XYFK || null;
    const xyCopyBtn = (raw, btnClass, innerHtml, title, okMsg) => XY
        ? '<button type="button" class="' + btnClass + '" data-xy-copy="' + XY.enc(raw) + '" data-xy-msg="' + XY.esc(okMsg) + '" title="' + title + '" aria-label="' + title + '">' + innerHtml + '</button>'
        : '';

    let resultHtml = '';
    if (processedCards.length > 0) {
        const cardItems = processedCards.map((card, i) =>
            '<div class="d-flex align-items-start p-2 mb-2 bg-white border rounded">'
            + '<div class="flex-grow-1 text-break user-select-all me-2" style="font-family:monospace;font-size:14px;color:#333;word-break:break-all;">' + (XY ? XY.esc(card) : card) + '</div>'
            + xyCopyBtn(rawCards[i], 'btn btn-sm btn-outline-secondary px-2 py-1 flex-shrink-0', '<i class="far fa-copy"></i>', '复制这条卡密', '已复制 1 条卡密')
            + '</div>'
        ).join('');
        resultHtml = '<div class="alert alert-success mt-3 shadow-sm border-0">'
            + '<div class="d-flex justify-content-between align-items-center mb-3">'
            + '<h6 class="alert-heading fw-bold mb-0"><i class="fas fa-gift me-2"></i>您的卡密信息</h6>'
            + xyCopyBtn(rawCards.join('\n'), 'btn btn-sm btn-success rounded-pill px-3', '<i class="far fa-copy me-1"></i>复制全部', '复制全部卡密', '已复制 ' + rawCards.length + ' 条卡密')
            + '</div>'
            + '<div class="bg-light p-3 rounded border">' + cardItems + '</div>'
            + '<div class="mt-2 text-muted small text-center"><i class="fas fa-info-circle"></i> 点击 <i class="far fa-copy"></i> 图标一键复制（复制纯卡密），或长按卡密手动复制</div>'
            + '</div>';
    } else {
        resultHtml = '<div class="alert alert-warning mt-3">'
            + '<h6 class="alert-heading fw-bold text-danger">等待发货</h6>'
            + '<p class="mb-0 fw-bold" style="color:red;">该订单包含手动发货商品，请联系商家发货。</p>'
            + '</div>';
    }

    // 替换页面主体内容为成功提示
    const mainArea = document.querySelector('.col-lg-9 .module-box') || document.querySelector('.col-lg-9');
    if (mainArea) {
        mainArea.innerHTML = '<div class="p-4 text-center">'
            + '<i class="fa fa-check-circle text-success fa-4x mb-3"></i>'
            + '<h5 class="text-success fw-bold mb-2">' + (msg || '支付成功！') + '</h5>'
            + resultHtml
            + '<div class="text-center mt-4">'
            + '<a href="/member" class="btn btn-outline-primary rounded-pill px-4 me-2">查看我的订单</a>'
            + '<a href="/" class="btn btn-primary rounded-pill px-4">继续购物</a>'
            + '</div></div>';
    } else {
        alert(msg || '支付成功！');
    }
};

window.cartBalancePay = async function() {
    const token = localStorage.getItem('member_token');
    if (!token) { if(confirm('请先登录会员才能使用余额支付，是否前往登录？')) window.location.href='/member/login'; return; }
    const checked = cart.filter(t => t.checked !== false);
    if (checked.length === 0) return alert('请选择要结算的商品');
    const contact = (document.getElementById('contact-info').value.trim() || document.getElementById('contact-info-mobile').value.trim());
    const pwd = (document.getElementById('query-password').value.trim() || document.getElementById('query-password-mobile').value.trim());
    // 会员无需验证联系方式和查单密码
    localStorage.setItem('userContact', contact);
    localStorage.setItem('userPassword', pwd);
    const btns = document.querySelectorAll('button[onclick="cartBalancePay()"]');
    btns.forEach(b => { b.disabled = true; b.innerHTML = '<i class="fa fa-spinner fa-spin"></i> 下单中...'; });
    try {
        const items = checked.map(normalizeItem);
        const createRes = await fetch('/api/shop/cart/checkout', {
            method: 'POST', headers: {'Content-Type':'application/json', 'Authorization': 'Bearer '+token},
            body: JSON.stringify({ items, contact, query_password: pwd, payment_method: 'balance' })
        });
        const createData = await createRes.json();
        if (createData.error) { alert(createData.error); btns.forEach(b => { b.disabled = false; b.innerHTML = '<i class="fas fa-wallet me-1"></i>使用余额支付'; }); return; }
        const payRes = await fetch('/api/member/balance_pay', {
            method: 'POST', headers: {'Authorization': 'Bearer '+token, 'Content-Type':'application/json'},
            body: JSON.stringify({ order_id: createData.order_id })
        });
        const payData = await payRes.json();
        if (payData.error) { alert(payData.error); btns.forEach(b => { b.disabled = false; b.innerHTML = '<i class="fas fa-wallet me-1"></i>使用余额支付'; }); return; }
        const remaining = cart.filter(t => !t.checked);
        localStorage.setItem('tbShopCart', JSON.stringify(remaining));
        let msg = '支付成功！余额：¥' + payData.balance.toFixed(2);
        if (createData.discount) msg += '\n🎉 会员折扣已生效';
        showCartCards(payData.cards||[],msg);
    } catch(e) { alert('请求失败'); }
    btns.forEach(b => { b.disabled = false; b.innerHTML = '<i class="fas fa-wallet me-1"></i>使用余额支付'; });
};
