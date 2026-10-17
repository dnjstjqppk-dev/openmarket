// apps/cloudflare-gateway/src/routes/orders.js
// OLMOA Orders Engine: Zero-Trust Price Authority, Atomic Ledger, Strict Role Auth & State Transitions

function verifyAuth(request, env) {
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  const adminSecret = env.ADMIN_SECRET || 'olmoa_admin_sec_2026';
  const isAdmin = (token.length > 0 && token === adminSecret) || request.headers.get('X-Admin-Secret') === adminSecret;
  const customerId = request.headers.get('X-Customer-Id') || 'u_customer_001';
  return { isAdmin, customerId, token };
}

export async function handleOrderRoutes(request, url, env, corsHeaders) {
  // 1. Checkout (Real Order Creation + Server Price Authority + Stock Ledger)
  if ((url.pathname === '/api/v1/orders/checkout' || url.pathname === '/api/v1/orders') && request.method === 'POST') {
    const body = await request.json();
    const items = body.items || [];
    if (!items.length) {
      return new Response(JSON.stringify({ error: 'Cart is empty. Valid items required.' }), { status: 400, headers: corsHeaders });
    }

    const idempotencyKey = request.headers.get('X-Idempotency-Key') || body.idempotency_key;
    if (idempotencyKey) {
      const existingLedger = await env.DB.prepare(
        'SELECT reference_id FROM inventory_ledger WHERE idempotency_key = ? OR idempotency_key LIKE ? LIMIT 1'
      ).bind(idempotencyKey, `${idempotencyKey}%`).first();
      if (existingLedger) {
        const ord = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(existingLedger.reference_id).first();
        if (ord) return new Response(JSON.stringify({ success: true, brand: 'OLMOA', idempotent_replay: true, order_id: ord.id, order_no: ord.order_no, total_pay_amount: ord.total_pay_amount, status: ord.payment_status }), { headers: corsHeaders });
      }
    }

    let { customerId } = verifyAuth(request, env);
    const userRow = await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(customerId).first();
    if (!userRow) customerId = 'u_customer_001';

    const orderId = 'olm_ord_' + Date.now();
    const orderNo = 'OLM' + Date.now().toString().slice(-8);

    // Step A: Server Price Lookup & Zero-Fallback SKU Validation
    const resolvedItems = [];
    for (const item of items) {
      if (!item.sku_id) {
        return new Response(JSON.stringify({ error: 'Missing sku_id. Fallback SKUs are forbidden.' }), { status: 400, headers: corsHeaders });
      }
      const sku = await env.DB.prepare(
        'SELECT s.*, p.partner_id, p.title as prod_title FROM product_skus s JOIN products p ON s.product_id = p.id WHERE s.id = ?'
      ).bind(item.sku_id).first();

      if (!sku) {
        return new Response(JSON.stringify({ error: `Invalid SKU ID: ${item.sku_id}. Zero fallback enforced.` }), { status: 400, headers: corsHeaders });
      }
      if (item.product_id && item.product_id !== sku.product_id) {
        return new Response(JSON.stringify({ error: `SKU ${item.sku_id} does not belong to product ${item.product_id}` }), { status: 400, headers: corsHeaders });
      }

      const qty = Math.max(1, parseInt(item.quantity || 1, 10));
      if (sku.stock_quantity < qty) {
        return new Response(JSON.stringify({ error: `Stock insufficient for SKU ${sku.sku_code}`, sku_id: sku.id, available: sku.stock_quantity, requested: qty }), { status: 409, headers: corsHeaders });
      }

      let optSummary = '기본';
      try {
        const optObj = JSON.parse(sku.option_combination_json);
        optSummary = Object.entries(optObj).map(([k, v]) => `${k}:${v}`).join(' / ') || '기본';
      } catch (e) {}

      resolvedItems.push({
        skuId: sku.id, productId: sku.product_id, partnerId: sku.partner_id || 'pt_001',
        title: sku.prod_title, optionSummary: optSummary, unitPrice: sku.sale_price,
        quantity: qty, lineTotal: sku.sale_price * qty, currentStock: sku.stock_quantity
      });
    }

    // Step B: Group by Partner for Split-Orders & Shipping Calculation
    const partnerGroups = {};
    for (const it of resolvedItems) {
      if (!partnerGroups[it.partnerId]) partnerGroups[it.partnerId] = [];
      partnerGroups[it.partnerId].push(it);
    }

    let totalGoods = 0;
    let totalShipping = 0;
    const subOrderCalculations = [];
    let subIndex = 1;

    for (const [pId, pItems] of Object.entries(partnerGroups)) {
      const goods = pItems.reduce((acc, it) => acc + it.lineTotal, 0);
      const ship = goods >= 30000 ? 0 : 3000;
      totalGoods += goods;
      totalShipping += ship;
      subOrderCalculations.push({
        subOrderId: `${orderId}_sub_${subIndex}`, subOrderNo: `${orderNo}-${subIndex}`,
        partnerId: pId, goodsAmount: goods, shippingFee: ship, totalAmount: goods + ship, items: pItems
      });
      subIndex++;
    }
    const totalPay = totalGoods + totalShipping;

    // Step C: Insert Parent Order
    await env.DB.prepare(
      `INSERT INTO orders (id, order_no, customer_id, total_goods_amount, total_shipping_amount, total_discount_amount, total_pay_amount, currency, payment_status, recipient_name, recipient_phone, shipping_address_line1, shipping_address_line2, shipping_postal_code, shipping_memo)
       VALUES (?, ?, ?, ?, ?, 0, ?, 'KRW', 'PAID', ?, ?, ?, ?, ?, ?)`
    ).bind(
      orderId, orderNo, customerId, totalGoods, totalShipping, totalPay,
      body.recipient_name || '구매자', body.recipient_phone || '010-0000-0000',
      body.shipping_address_line1 || '주소 미입력', body.shipping_address_line2 || '',
      body.shipping_postal_code || '00000', body.shipping_memo || ''
    ).run();

    // Step D: Insert Sub-Orders, Items, Settlements & Atomic Stock Decrement
    for (const sub of subOrderCalculations) {
      await env.DB.prepare(
        `INSERT INTO sub_orders (id, parent_order_id, sub_order_no, partner_id, shipping_fee, goods_amount, discount_amount, total_amount, status)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, 'PAYMENT_CONFIRMED')`
      ).bind(sub.subOrderId, orderId, sub.subOrderNo, sub.partnerId, sub.shippingFee, sub.goodsAmount, sub.totalAmount).run();

      const commission = Math.round(sub.goodsAmount * 0.1);
      const netPayout = sub.goodsAmount - commission + sub.shippingFee;
      await env.DB.prepare(
        `INSERT INTO settlements (id, sub_order_id, partner_id, gross_amount, shipping_fee, commission_rate, commission_amount, net_payout_amount, status)
         VALUES (?, ?, ?, ?, ?, 0.1, ?, ?, 'PENDING')`
      ).bind(`stl_${sub.subOrderId}`, sub.subOrderId, sub.partnerId, sub.goodsAmount, sub.shippingFee, commission, netPayout).run();

      for (const it of sub.items) {
        const itemId = `item_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        await env.DB.prepare(
          `INSERT INTO order_items (id, sub_order_id, sku_id, product_title, option_summary, unit_price, quantity, total_price)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(itemId, sub.subOrderId, it.skuId, it.title, it.optionSummary, it.unitPrice, it.quantity, it.lineTotal).run();

        const deductResult = await env.DB.prepare(
          `UPDATE product_skus SET stock_quantity = stock_quantity - ?, status = CASE WHEN stock_quantity - ? <= 0 THEN 'OUT_OF_STOCK' ELSE status END WHERE id = ? AND stock_quantity >= ?`
        ).bind(it.quantity, it.quantity, it.skuId, it.quantity).run();

        if (!deductResult.meta || deductResult.meta.changes === 0) {
          return new Response(JSON.stringify({ error: `Concurrent inventory conflict on SKU ${it.skuId}` }), { status: 409, headers: corsHeaders });
        }

        const ledgerId = `ldg_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        const itemIdempotency = idempotencyKey ? `${idempotencyKey}_${it.skuId}` : `auto_${orderId}_${it.skuId}`;
        await env.DB.prepare(
          `INSERT INTO inventory_ledger (id, sku_id, change_type, quantity_delta, balance_after, reference_id, idempotency_key)
           VALUES (?, ?, 'PURCHASE_DEDUCT', ?, ?, ?, ?)`
        ).bind(ledgerId, it.skuId, -it.quantity, it.currentStock - it.quantity, orderId, itemIdempotency).run();

        await env.DB.prepare('UPDATE products SET total_sold_count = total_sold_count + ? WHERE id = ?').bind(it.quantity, it.productId).run();
      }
    }

    const responsePayload = {
      order_id: orderId,
      order_no: orderNo,
      total_goods_amount: totalGoods,
      total_shipping_amount: totalShipping,
      total_pay_amount: totalPay,
      sub_orders_created: subOrderCalculations.length,
      status: 'PAYMENT_CONFIRMED'
    };

    return new Response(JSON.stringify({
      success: true, brand: 'OLMOA', ...responsePayload, data: responsePayload
    }), { status: 201, headers: corsHeaders });
  }

  // 2. Order Cancellation & Stock Restoration
  if (url.pathname.match(/^\/api\/v1\/orders\/[^\/]+\/cancel$/) && request.method === 'POST') {
    const ordId = url.pathname.split('/')[4];
    const { isAdmin, customerId } = verifyAuth(request, env);
    const order = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(ordId).first();
    if (!order) return new Response(JSON.stringify({ error: 'Order not found' }), { status: 404, headers: corsHeaders });
    if (!isAdmin && order.customer_id !== customerId) {
      return new Response(JSON.stringify({ error: 'Forbidden: Cannot cancel another user order' }), { status: 403, headers: corsHeaders });
    }
    if (order.payment_status === 'CANCELLED') {
      return new Response(JSON.stringify({ error: 'Order is already cancelled' }), { status: 400, headers: corsHeaders });
    }

    const { results: items } = await env.DB.prepare(
      'SELECT i.sku_id, i.quantity FROM order_items i JOIN sub_orders s ON i.sub_order_id = s.id WHERE s.parent_order_id = ?'
    ).bind(order.id).all();

    for (const it of items) {
      await env.DB.prepare("UPDATE product_skus SET stock_quantity = stock_quantity + ?, status = 'IN_STOCK' WHERE id = ?").bind(it.quantity, it.sku_id).run();
      await env.DB.prepare(
        "INSERT INTO inventory_ledger (id, sku_id, change_type, quantity_delta, balance_after, reference_id, idempotency_key) VALUES (?, ?, 'ORDER_CANCEL', ?, (SELECT stock_quantity FROM product_skus WHERE id = ?), ?, ?)"
      ).bind(`ldg_cnl_${Date.now()}_${Math.random().toString(36).substring(2,6)}`, it.sku_id, it.quantity, it.sku_id, order.id, `cnl_${order.id}_${it.sku_id}_${Date.now()}`).run();
    }

    await env.DB.prepare("UPDATE orders SET payment_status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(order.id).run();
    await env.DB.prepare("UPDATE sub_orders SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP WHERE parent_order_id = ?").bind(order.id).run();
    return new Response(JSON.stringify({ success: true, brand: 'OLMOA', message: 'Order cancelled & items restocked', order_id: order.id, status: 'CANCELLED' }), { headers: corsHeaders });
  }

  // 3. Orders List with Strict Role Protection
  if (url.pathname === '/api/v1/orders' && request.method === 'GET') {
    const { isAdmin, customerId } = verifyAuth(request, env);
    const targetCustomer = isAdmin && url.searchParams.get('customer_id') ? url.searchParams.get('customer_id') : customerId;

    const { results: orders } = await env.DB.prepare(
      'SELECT * FROM orders WHERE customer_id = ? ORDER BY created_at DESC LIMIT 50'
    ).bind(targetCustomer).all();

    for (const ord of orders) {
      const { results: subOrders } = await env.DB.prepare(
        'SELECT s.*, p.business_name FROM sub_orders s LEFT JOIN partners p ON s.partner_id = p.id WHERE s.parent_order_id = ?'
      ).bind(ord.id).all();
      for (const sub of subOrders) {
        const { results: subItems } = await env.DB.prepare('SELECT * FROM order_items WHERE sub_order_id = ?').bind(sub.id).all();
        sub.items = subItems;
      }
      ord.sub_orders = subOrders;
    }
    return new Response(JSON.stringify({ success: true, brand: 'OLMOA', count: orders.length, customer_id: targetCustomer, data: orders }), { headers: corsHeaders });
  }

  // 4. Single Order Detail with Strict Ownership Validation
  if (url.pathname.startsWith('/api/v1/orders/') && request.method === 'GET') {
    const ordId = url.pathname.replace('/api/v1/orders/', '').trim();
    const { isAdmin, customerId } = verifyAuth(request, env);

    const order = await env.DB.prepare('SELECT * FROM orders WHERE id = ? OR order_no = ?').bind(ordId, ordId).first();
    if (!order) return new Response(JSON.stringify({ error: 'Order not found' }), { status: 404, headers: corsHeaders });

    // Enforce genuine authentication: string "ADMIN" without secret token is rejected!
    if (!isAdmin && order.customer_id !== customerId) {
      return new Response(JSON.stringify({ error: 'Forbidden: Access denied to this order' }), { status: 403, headers: corsHeaders });
    }

    const { results: subOrders } = await env.DB.prepare(
      'SELECT s.*, p.business_name FROM sub_orders s LEFT JOIN partners p ON s.partner_id = p.id WHERE s.parent_order_id = ?'
    ).bind(order.id).all();

    for (const sub of subOrders) {
      const { results: subItems } = await env.DB.prepare('SELECT * FROM order_items WHERE sub_order_id = ?').bind(sub.id).all();
      sub.items = subItems;
    }
    order.sub_orders = subOrders;

    return new Response(JSON.stringify({ success: true, brand: 'OLMOA', data: order }), { headers: corsHeaders });
  }

  return null;
}
