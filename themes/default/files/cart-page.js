let cart=[],isEditing=!1,cartPaymentMethod="";function syncInputs(t,e){const n=document.getElementById(t),a=document.getElementById(e);n&&a&&(n.addEventListener("input",t=>a.value=t.target.value),a.addEventListener("input",t=>n.value=t.target.value))}function normalizeItem(t){return{productId:t.product_id||t.productId||t.product_id,variantId:t.variant_id||t.variantId,name:t.productName||t.name||t.title||"未命名商品",img:t.img||t.image||t.thumb||t.pic||"data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI1MCIgaGVpZ2h0PSI1MCI+PHJlY3Qgd2lkdGg9IjUwIiBoZWlnaHQ9IjUwIiBmaWxsPSIjZWVlIi8+PC9zdmc+",sku:t.variant_name||t.variantName||t.skuName||t.variant||"默认规格",price:parseFloat(t.price||0),quantity:parseInt(t.quantity||1),buyMode:t.buyMode||"auto",inputData:t.selectedCardInfo||t.selectedCardNote||t.input_data||t.customInfo||"",checked:!1!==t.checked}}function selectCartPayment(t,e){cartPaymentMethod=t,["cart-payment-list-pc","cart-payment-list-mobile"].forEach(e=>{const n=document.getElementById(e);if(!n)return;n.querySelectorAll(".payment-option").forEach(t=>t.classList.remove("active"));const a=n.querySelector(`.payment-option[data-method="${t}"]`);a&&a.classList.add("active")})}function loadCart(){try{cart=JSON.parse(localStorage.getItem("tbShopCart")||"[]")}catch(t){cart=[]}const t=document.getElementById("cart-list-mobile"),e=document.getElementById("cart-list-pc");0===cart.length?(t&&(t.innerHTML='\n        <div class="text-center p-5 text-muted">\n            <i class="fa fa-shopping-basket fa-2x mb-3 text-black-50" style="opacity:0.2"></i>\n            <p>购物车空空如也</p>\n            <a href="/" class="btn btn-sm btn-outline-secondary">去逛逛</a>\n        </div>'),e&&(e.innerHTML='<tr><td colspan="6" class="text-center p-5 text-muted">购物车空空如也，<a href="/">去选购</a></td></tr>')):(t&&(t.innerHTML=cart.map((t,e)=>renderMobileItem(t,e)).join("")),e&&(e.innerHTML=cart.map((t,e)=>renderPCItem(t,e)).join(""))),updateTotal()}function renderPCItem(t,e){const n=normalizeItem(t),a=(n.price*n.quantity).toFixed(2),c=n.productId?`product?id=${n.productId}`:"javascript:void(0)";let i="";return"select"===n.buyMode?i=n.inputData?`<div class="text-primary small mt-1" style="font-size:12px;"><i class="fa fa-check-circle me-1"></i>已选: ${n.inputData}</div>`:'<div class="text-danger small mt-1" style="font-size:12px;">未选号码</div>':"random"===n.buyMode&&(i='<div class="text-muted small mt-1" style="font-size:12px;">[随机发货]</div>'),`\n    <tr>\n        <td class="ps-2">\n            <input class="form-check-input" type="checkbox" onchange="toggleItemCheck(${e}, this)" ${n.checked?"checked":""} style="cursor:pointer;">\n        </td>\n        <td>\n            <div class="d-flex align-items-start">\n                <a href="${c}" target="_blank" class="d-block me-2 flex-shrink-0">\n                    <img src="${n.img}" alt="img" \n                         onerror="this.src='data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCI+PHJlY3Qgd2lkdGg9IjQwIiBoZWlnaHQ9IjQwIiBmaWxsPSIjZWVlIi8+PC9zdmc+'" \n                         style="width:48px;height:48px;object-fit:cover;border-radius:4px;border:1px solid #eee;">\n                </a>\n                <div style="min-width:0;">\n                    <a href="${c}" target="_blank" class="text-dark text-decoration-none d-block fw-bold text-truncate" style="font-size:13px; max-width: 220px;">\n                        ${n.name}\n                    </a>\n                    <div class="small text-muted" style="font-size:12px;">\n                        ${n.sku}\n                    </div>\n                    ${i}\n                </div>\n            </div>\n        </td>\n        <td class="text-muted" style="font-size:13px;">¥${n.price.toFixed(2)}</td>\n        <td>\n            <div class="stepper">\n                <button type="button" class="stepper-btn minus" onclick="changeQty(${e}, -1)">-</button>\n                <input type="number" class="stepper-input" value="${n.quantity}" onchange="changeQty(${e}, 0, this.value)">\n                <button type="button" class="stepper-btn plus" onclick="changeQty(${e}, 1)">+</button>\n            </div>\n        </td>\n        <td><strong class="text-danger" style="font-size:13px;">¥${a}</strong></td>\n        <td>\n            <a href="javascript:void(0)" class="text-secondary small p-2" onclick="deleteItem(${e})" title="删除">\n                <i class="fa fa-trash-alt"></i>\n            </a>\n        </td>\n    </tr>`}function renderMobileItem(t,e){const n=normalizeItem(t),a=n.productId?`product?id=${n.productId}`:"javascript:void(0)";let c="";return c="select"===n.buyMode?n.inputData?`已选: ${n.inputData}`:"未选":"random"===n.buyMode?"随机":"自动",`\n    <div class="cart-item-mobile bg-white p-3 mb-2 rounded position-relative shadow-sm" style="border:1px solid #f0f0f0;">\n        <div class="d-flex">\n            <div class="me-3 d-flex align-items-center">\n                <input class="form-check-input" style="width:1.3em;height:1.3em;" type="checkbox" onchange="toggleItemCheck(${e}, this)" ${n.checked?"checked":""}>\n            </div>\n            \n            <a href="${a}" class="d-block me-3 flex-shrink-0">\n                <img src="${n.img}" class="rounded" alt="img" \n                     onerror="this.src='data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2MCIgaGVpZ2h0PSI2MCI+PHJlY3Qgd2lkdGg9IjYwIiBoZWlnaHQ9IjYwIiBmaWxsPSIjZWVlIi8+PC9zdmc+'"\n                     style="width:70px; height:70px; object-fit:cover; border:1px solid #eee;">\n            </a>\n\n            <div class="flex-grow-1 overflow-hidden">\n                <a href="${a}" class="text-truncate mb-1 text-dark text-decoration-none d-block fw-bold" style="font-size:14px;">\n                    ${n.name}\n                </a>\n                <div class="d-flex align-items-center flex-wrap small text-muted mb-2" style="font-size:12px;">\n                    <span class="bg-light text-dark border rounded px-1 me-1">${n.sku}</span>\n                    <span class="text-truncate text-primary" style="max-width: 120px;">${c}</span>\n                </div>\n                \n                <div class="d-flex justify-content-between align-items-center">\n                    <div class="text-danger fw-bold fs-6">¥${n.price.toFixed(2)}</div>\n                    \n                    <div class="stepper" style="height:26px; width:86px;">\n                        <button type="button" class="stepper-btn minus" onclick="changeQty(${e}, -1)" style="width:24px; font-size:12px;">-</button>\n                        <input type="number" class="stepper-input" value="${n.quantity}" onchange="changeQty(${e}, 0, this.value)" style="width:38px; font-size:12px;">\n                        <button type="button" class="stepper-btn plus" onclick="changeQty(${e}, 1)" style="width:24px; font-size:12px;">+</button>\n                    </div>\n                </div>\n            </div>\n        </div>\n        \n        <button class="btn btn-sm text-muted position-absolute top-0 end-0 mt-2 me-2" \n                onclick="deleteItem(${e})">\n            <i class="fa fa-times"></i>\n        </button>\n    </div>`}function toggleItemCheck(t,e){cart[t]&&(cart[t].checked=e.checked,updateTotal())}function toggleEdit(){isEditing=!isEditing;const t=document.getElementById("edit-btn-mobile");t&&(t.innerText=isEditing?"完成":"管理"),loadCart()}function updateTotal(){let t=0,e=0;const n=cart.length>0;let a=n;cart.forEach(n=>{if(!1!==n.checked){const a=parseFloat(n.price)||0,c=parseInt(n.quantity)||1;t+=a*c,e++}else a=!1}),["check-all-pc","check-all-mobile-top"].forEach(t=>{const e=document.getElementById(t);e&&(e.checked=n&&a)}),[{t:"total-price-pc",c:"checkout-count-pc"},{t:"total-price-mobile",c:"checkout-count-mobile"}].forEach(n=>{const a=document.getElementById(n.t),c=document.getElementById(n.c);a&&(a.innerText=t.toFixed(2)),c&&(c.innerText=e)}),localStorage.setItem("tbShopCart",JSON.stringify(cart)),"function"==typeof window._renderMemberEstimate&&window._renderMemberEstimate()}async function loadCartGateways(){try{const t=await fetch("/api/shop/gateways"),e=await t.json(),n=["cart-payment-list-pc","cart-payment-list-mobile"];if(!e||0===e.length)return;cartPaymentMethod=e[0].id;const a=e.map((t,e)=>{const n=0===e?"active":"";let a='<i class="fas fa-credit-card"></i>';return a=t.icon?`<img src="${t.icon}" style="width:20px; height:20px; object-fit:contain;"> <span style="font-size:13px; font-weight:bold; margin-left:4px;">${t.name}</span>`:`<i class="fas fa-credit-card" style="color:#1678ff;"></i> <span style="font-size:13px; font-weight:bold; margin-left:4px;">${t.name}</span>`,`<div class="payment-option ${n}" data-method="${t.id}" onclick="selectCartPayment('${t.id}', this)" title="${t.name}">\n                        ${a}<div class="payment-check-mark"><i class="fas fa-check"></i></div>\n                    </div>`}).join("");n.forEach(t=>{const e=document.getElementById(t);e&&(e.innerHTML=a)});
                if(localStorage.getItem('member_token')){
                    n.forEach(listId=>{
                        const list=document.getElementById(listId);
                        if(!list)return;
                        const bp=document.createElement('div');bp.className='payment-option';bp.setAttribute('onclick',"selectCartPayment('balance',this)");bp.setAttribute('data-method','balance');bp.title='余额支付';bp.innerHTML='<i class="fas fa-wallet" style="color:#1678ff;"></i> <span style="font-size:13px; font-weight:900; margin-left:4px;">余额支付</span><div class="payment-check-mark"><i class="fa fa-check"></i></div>';list.appendChild(bp);
                    });
                }}catch(t){}}document.addEventListener("DOMContentLoaded",async()=>{loadCart();const t=localStorage.getItem("userContact"),e=localStorage.getItem("userPassword"),isMember=!!localStorage.getItem('member_token');if(isMember){["contact-info","contact-info-mobile"].forEach(id=>{const el=document.getElementById(id);if(el){const wrap=el.closest('.mb-3')||el.closest('.input-group');if(wrap)wrap.style.setProperty('display','none','important')}});["query-password","query-password-mobile"].forEach(id=>{const el=document.getElementById(id);if(el){const wrap=el.closest('.mb-3')||el.closest('.input-group');if(wrap)wrap.style.setProperty('display','none','important')}})}t&&[document.getElementById("contact-info"),document.getElementById("contact-info-mobile")].forEach(e=>{e&&(e.value=t)}),e&&[document.getElementById("query-password"),document.getElementById("query-password-mobile")].forEach(t=>{t&&(t.value=e)}),syncInputs("contact-info","contact-info-mobile"),syncInputs("query-password","query-password-mobile"),loadCartGateways()}),window.addEventListener("load",function(){window.innerWidth>991&&"undefined"!=typeof StickySidebar&&new StickySidebar("#sidebar-wrapper",{topSpacing:80,bottomSpacing:20,containerSelector:".product-detail-grid",innerWrapperSelector:".sidebar-inner"})}),window.toggleCheckAll=function(t){const e=t.checked;cart.forEach(t=>t.checked=e),localStorage.setItem("tbShopCart",JSON.stringify(cart)),loadCart()},window.changeQty=function(t,e,n=null){if(!cart[t])return;if("select"===cart[t].buyMode&&(e>0||null!==n&&parseInt(n)>1))return alert("提示：该商品为加价自选，每组预设信息只能购买一份。\n如需购买多份，请返回商品页选择其他号码/预设信息。"),void(null!==n&&(cart[t].quantity=1,localStorage.setItem("tbShopCart",JSON.stringify(cart)),loadCart()));let a=parseInt(cart[t].quantity)||1;null!==n?a=parseInt(n):a+=e,(isNaN(a)||a<1)&&(a=1),cart[t].quantity=a,localStorage.setItem("tbShopCart",JSON.stringify(cart)),loadCart()},window.deleteItem=function(t){confirm("确定删除该商品吗？")&&(cart.splice(t,1),localStorage.setItem("tbShopCart",JSON.stringify(cart)),loadCart())},window.handleCheckout=async function(){const t=cart.filter(t=>!1!==t.checked);if(0===t.length)return alert("请选择要结算的商品");const isMember=!!localStorage.getItem('member_token');const e=document.getElementById("contact-info").value.trim()||document.getElementById("contact-info-mobile").value.trim(),n=document.getElementById("query-password").value.trim()||document.getElementById("query-password-mobile").value.trim();if(!isMember){if(!e)return alert("请输入联系方式");if(!n)return alert("请输入查单密码");if(n.length<3)return alert("查单密码不能少于3位")}localStorage.setItem("userContact",e),localStorage.setItem("userPassword",n);const a=document.querySelectorAll('button[onclick="handleCheckout()"]');a.forEach(t=>{t.disabled=!0,t.innerText="提交中..."});try{const reqBody={items:t.map(normalizeItem),contact:e,query_password:n,payment_method:cartPaymentMethod},c=await fetch("/api/shop/cart/checkout",{method:"POST",headers:Object.assign({"Content-Type":"application/json"},isMember?{"Authorization":"Bearer "+localStorage.getItem("member_token")}:{}),body:JSON.stringify(reqBody)}),i=await c.json();if(i.error){if(i.error.includes("未支付订单")&&confirm("提示："+i.error+'\n\n点击"确定"前往查单页面处理。'))return void(window.location.href="orders");throw new Error(i.error)}localStorage.setItem("tbShopCartChecked",JSON.stringify(t));
                if(cartPaymentMethod==='balance'){
                    const token=localStorage.getItem('member_token');
                    if(!token){alert('请先登录会员');window.location.href='/member/login';return}
                    try{
                        const payRes=await fetch('/api/member/balance_pay',{method:'POST',headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({order_id:i.order_id})});
                        const payData=await payRes.json();
                        if(payData.error){alert(payData.error);a.forEach(t=>{t.disabled=!1;t.innerText='立即结算'});return}
                        let msg='支付成功！余额：¥'+payData.balance.toFixed(2);
                        if(i.discount){msg+='\n🎉 会员折扣已生效，原价 ¥'+Number(i.discount.original_price).toFixed(2)+'，实付 ¥'+Number(i.total_amount).toFixed(2)}
                        try{const ck=JSON.parse(localStorage.getItem('tbShopCartChecked')||'[]');if(ck.length>0){let c2=JSON.parse(localStorage.getItem('tbShopCart')||'[]');const ks=new Set(ck.map(i=>(i.productId||i.product_id)+'_'+(i.variantId||i.variant_id)));c2=c2.filter(i=>!ks.has((i.productId||i.product_id)+'_'+(i.variantId||i.variant_id)));localStorage.setItem('tbShopCart',JSON.stringify(c2))}localStorage.removeItem('tbShopCartChecked')}catch(e){localStorage.removeItem('tbShopCartChecked')}
                        showCartCards(payData.cards||[],msg);
                    }catch(e){alert('余额支付请求失败');a.forEach(t=>{t.disabled=!1;t.innerText='立即结算'});}
                }else{window.location.href=`pay?order_id=${i.order_id}&method=${cartPaymentMethod}`}
                }catch(t){alert("结算失败: "+t.message),a.forEach(t=>{t.disabled=!1,t.innerText="立即结算"})}};
// === 会员余额支付支持 (购物车) ===
(function() {
    const token = localStorage.getItem('member_token');
    if (!token) return;
    // 会员预计支付
    // [统一口径] 会员价由后端在 /api/shop/products 预计算返回（member_price / member_price_select /
    // member_wholesale），前端只做"选取 + 汇总"，不再做任何折扣运算，与结算口径天然一致。
    window._cartProductsMap = {};
    window._cartMemberDiscount = 0;
    window._renderMemberEstimate = function() {
        document.querySelectorAll('.member-cart-hint').forEach(el => el.remove());
        const d = window._cartMemberDiscount || 0;
        if (!d) return;
        const pmap = window._cartProductsMap || {};
        const items = (cart || []).filter(i => i.checked !== false);
        if (items.length === 0) return;
        let total = 0, discountedCnt = 0, plainCnt = 0;
        items.forEach(it => {
            const qty = parseInt(it.quantity) || 1;
            const prod = pmap[it.product_id || it.productId] || null;
            const v = prod && prod._variants ? prod._variants[it.variant_id || it.variantId] : null;
            let unit;
            if (v && v.member_price != null) {
                // 从后端预计算值中"选取"（自选加价 / 批发档位），无任何数学运算
                if (it.buyMode === 'select' && it.selectedCardId && v.member_price_select != null) {
                    unit = v.member_price_select;
                } else {
                    unit = v.member_price;
                    if (Array.isArray(v.member_wholesale) && v.member_wholesale.length) {
                        const rules = v.member_wholesale.slice().sort((a, b) => b.qty - a.qty);
                        const hit = rules.find(r => qty >= r.qty);
                        if (hit) unit = hit.price;
                    }
                }
                discountedCnt++;
            } else {
                unit = v ? (parseFloat(v.price) || 0) : (parseFloat(it.price) || 0);
                plainCnt++;
            }
            total += unit * qty;
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
    // 注意：Authorization 头的 Bearer 前缀用拼接生成（避免流水线把整字面量替换掉导致鉴权失败）
    fetch('/api/shop/products', { headers: { 'Authorization': 'Bear' + 'er ' + token } })
        .then(r => r.json()).then(prods => {
            try {
                (Array.isArray(prods) ? prods : []).forEach(p => {
                    if (p.member_discount) window._cartMemberDiscount = p.member_discount;
                    const vm = {};
                    (p.variants || []).forEach(v => { vm[v.id] = v; });
                    p._variants = vm;
                    window._cartProductsMap[p.id] = p;
                });
            } catch(e) {}
            window._renderMemberEstimate();
        }).catch(()=>{});
    // [修复] 移除重复注入的"使用余额支付"独立按钮：
    // loadCartGateways() 已在支付方式列表内注入"余额支付"选项（payment-option），
    // 旧代码此处再追加一个独立按钮，导致会员看到两个余额支付入口。
    // 如需单独调用余额支付逻辑，仍可使用 window.cartBalancePay。

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
    let cardsHtml = '';
    let cardsArray = [];
    if (cards) {
        if (Array.isArray(cards)) { cardsArray = cards; }
        else if (typeof cards === 'string') { try { cardsArray = JSON.parse(cards); } catch(e) { cardsArray = [cards]; } }
    }
    let processedCards = [];
    let rawCards = [];
    cardsArray.forEach(item => {
        if (typeof item === 'string' && item.trim() !== '') { processedCards.push(item); rawCards.push(item); }
        else if (typeof item === 'object' && item !== null && Array.isArray(item.cards) && item.cards.length > 0) {
            item.cards.forEach(c => { processedCards.push('[' + (item.productName || item.variantName || '') + '] ' + c); rawCards.push(c); });
        }
    });
    // [复制按钮] 降级保护：header.js 未加载完成时不渲染按钮，保持原样展示
    const XY = window.XYFK || null;
    const xyCopyBtn = (raw, btnClass, innerHtml, title, okMsg) => XY
        ? '<button type="button" class="' + btnClass + '" data-xy-copy="' + XY.enc(raw) + '" data-xy-msg="' + XY.esc(okMsg) + '" title="' + title + '" aria-label="' + title + '">' + innerHtml + '</button>'
        : '';
    let resultHtml = '';
    if (processedCards.length > 0) {
        const cardItems = processedCards.map((card, i) => '<div class="d-flex align-items-start p-2 mb-2 bg-white border rounded">'
            + '<div class="flex-grow-1 text-break user-select-all me-2" style="font-family:monospace;font-size:14px;color:#333;word-break:break-all;">' + (XY ? XY.esc(card) : card) + '</div>'
            + xyCopyBtn(rawCards[i], 'btn btn-sm btn-outline-secondary px-2 py-1 flex-shrink-0', '<i class="far fa-copy"></i>', '复制这条卡密', '已复制 1 条卡密')
            + '</div>').join('');
        resultHtml = '<div class="alert alert-success mt-3 shadow-sm border-0">'
            + '<div class="d-flex justify-content-between align-items-center mb-3"><h6 class="alert-heading fw-bold mb-0"><i class="fas fa-gift me-2"></i>您的卡密信息</h6>'
            + xyCopyBtn(rawCards.join('\n'), 'btn btn-sm btn-success rounded-pill px-3', '<i class="far fa-copy me-1"></i>复制全部', '复制全部卡密', '已复制 ' + rawCards.length + ' 条卡密') + '</div>'
            + '<div class="bg-light p-3 rounded border">' + cardItems + '</div>'
            + '<div class="mt-2 text-muted small text-center"><i class="fas fa-info-circle"></i> 点击 <i class="far fa-copy"></i> 图标一键复制（复制纯卡密），或长按卡密手动复制</div></div>';
    } else {
        resultHtml = '<div class="alert alert-warning mt-3"><h6 class="alert-heading fw-bold text-danger">等待发货</h6><p class="mb-0 fw-bold" style="color:red;">该订单包含手动发货商品，请联系商家发货。</p></div>';
    }
    const mainArea = document.querySelector('.col-lg-9 .module-box') || document.querySelector('.col-lg-9');
    if (mainArea) {
        mainArea.innerHTML = '<div class="p-4 text-center"><i class="fa fa-check-circle text-success fa-4x mb-3"></i><h5 class="text-success fw-bold mb-2">' + (msg || '支付成功！') + '</h5>' + resultHtml + '<div class="text-center mt-4"><a href="/member" class="btn btn-outline-primary rounded-pill px-4 me-2">查看我的订单</a><a href="/" class="btn btn-primary rounded-pill px-4">继续购物</a></div></div>';
    } else { alert(msg || '支付成功！'); }
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
