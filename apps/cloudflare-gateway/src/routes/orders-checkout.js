// apps/cloudflare-gateway/src/routes/orders-checkout.js
// OLMOA Atomic Checkout Engine: Zero-Trust Pricing, D1 Batch Transaction, Partner Shipping

export async function processCheckout(request, env, corsHeaders, auth) {
  const body = await request.json();
  const items = body.items || [];
  if (!items.length) {
    return new Response(JSON.stringify({ error: 'Cart is empty. Valid items required.' }), { status: 400, headers: corsHeaders });
  }

  // 1. Strict Idempotency Check (Exact Match)
  const idempotencyKey = request.headers.get('X-Idempotency-Key') || body.idempotency_key;
  if (idempotencyKey) {
    const existingLedger = await env.DB.prepare(
      'SELECT reference_id FROM inventory_ledger WHERE idempotency_key = ? LIMIT 1'
    ).bind(idempotencyKey).first();
    if (existingLedger) {
      const ord = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(existingLedger.reference_id).first();
      if (ord) {
        return new Response(JSON.stringify({
          success: true, brand: 'OLMOA', idempotent_replay: true,
          order_id: ord.id, order_no: ord.order_no,
          total_pay_amount: ord.total_pay_amount, status: ord.payment_status
        }), { headers: corsHeaders });
      }
    }
  }

  // 2. Validate Customer Account
  const customerId = auth.customerId;
  const userRow = await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(customerId).first();
  if (!userRow) {
    return new Response(JSON.stringify({ error: 'Unauthorized: User account not found.' }), { status: 401, headers: corsHeaders });
  }

  const orderId = 'olm_ord_' + Date.now();
  const orderNo = 'OLM' + Date.now().toString().slice(-8);

  // 3. Pre-Validate Stock and Calculate Authentic Server Pricing
  const resolvedItems = [];
  for (const item of items) {
    if (!item.sku_id) {
      return new Response(JSON.stringify({ error: 'Missing sku_id. Fallback SKUs are forbidden.' }), { status: 400, headers: corsHeaders });
    }
    const sku = await env.DB.prepare(
      `SELECT s.*, p.partner_id, p.title as prod_title,
              pt.base_shipping_fee, pt.free_shipping_threshold
       FROM product_skus s
       JOIN products p ON s.product_id = p.id
       LEFT JOIN partners pt ON p.partner_id = pt.id
       WHERE s.id = ?`
    ).bind(item.sku_id).first();

    if (!sku) {
      return new Response(JSON.stringify({ error: `Invalid SKU ID: ${item.sku_id}. Zero fallback enforced.` }), { status: 400, headers: corsHeaders });
    }
    if (item.product_id && item.product_id !== sku.product_id) {
      return new Response(JSON.stringify({ error: `SKU ${item.sku_id} does not belong to product ${item.product_id}` }), { status: 400, headers: corsHeaders });
    }

    const qty = Math.max(1, parseInt(item.quantity || 1, 10));
    if (sku.stock_quantity < qty) {
      return new Response(JSON.stringify({
        error: `Stock insufficient for SKU ${sku.sku_code || sku.id}`,
        sku_id: sku.id,
        available: sku.stock_quantity,
        requested: qty
      }), { status: 409, headers: corsHeaders });
    }

    let optSummary = '기본';
    try {
      const optObj = JSON.parse(sku.option_combination_json);
      optSummary = Object.entries(optObj).map(([k, v]) => `${k}:${v}`).join(' / ') || '기본';
    } catch (_) {}

    resolvedItems.push({
      skuId: sku.id, productId: sku.product_id, partnerId: sku.partner_id || 'pt_001',
      title: sku.prod_title, optionSummary: optSummary, unitPrice: sku.sale_price,
      quantity: qty, lineTotal: sku.sale_price * qty, currentStock: sku.stock_quantity,
      baseShippingFee: sku.base_shipping_fee, freeShippingThreshold: sku.free_shipping_threshold
    });
  }

  // 4. Group by Partner & Compute Real Shipping Fees (WO-04)
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
    const threshold = pItems[0].freeShippingThreshold !== null && pItems[0].freeShippingThreshold !== undefined
      ? pItems[0].freeShippingThreshold
      : 30000;
    const baseFee = pItems[0].baseShippingFee !== null && pItems[0].baseShippingFee !== undefined
      ? pItems[0].baseShippingFee
      : 3000;
    const ship = (threshold > 0 && goods >= threshold) ? 0 : baseFee;

    totalGoods += goods;
    totalShipping += ship;
    subOrderCalculations.push({
      subOrderId: `${orderId}_sub_${subIndex}`, subOrderNo: `${orderNo}-${subIndex}`,
      partnerId: pId, goodsAmount: goods, shippingFee: ship, totalAmount: goods + ship, items: pItems
    });
    subIndex++;
  }
  const totalPay = totalGoods + totalShipping;

  // 5. Build Atomic D1 Batch (WO-03)
  const batchStatements = [];
  batchStatements.push(env.DB.prepare(
    `INSERT INTO orders (id, order_no, customer_id, total_goods_amount, total_shipping_amount, total_discount_amount, total_pay_amount, currency, payment_status, recipient_name, recipient_phone, shipping_address_line1, shipping_address_line2, shipping_postal_code, shipping_memo)
     VALUES (?, ?, ?, ?, ?, 0, ?, 'KRW', 'PAID', ?, ?, ?, ?, ?, ?)`
  ).bind(
    orderId, orderNo, customerId, totalGoods, totalShipping, totalPay,
    body.recipient_name || '구매자', body.recipient_phone || '010-0000-0000',
    body.shipping_address_line1 || '주소 미입력', body.shipping_address_line2 || '',
    body.shipping_postal_code || '00000', body.shipping_memo || ''
  ));

  for (const sub of subOrderCalculations) {
    batchStatements.push(env.DB.prepare(
      `INSERT INTO sub_orders (id, parent_order_id, sub_order_no, partner_id, shipping_fee, goods_amount, discount_amount, total_amount, status)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, 'PAYMENT_CONFIRMED')`
    ).bind(sub.subOrderId, orderId, sub.subOrderNo, sub.partnerId, sub.shippingFee, sub.goodsAmount, sub.totalAmount));

    const commission = Math.round(sub.goodsAmount * 0.1);
    const netPayout = sub.goodsAmount - commission + sub.shippingFee;
    batchStatements.push(env.DB.prepare(
      `INSERT INTO settlements (id, sub_order_id, partner_id, gross_amount, shipping_fee, commission_rate, commission_amount, net_payout_amount, status)
       VALUES (?, ?, ?, ?, ?, 0.1, ?, ?, 'PENDING')`
    ).bind(`stl_${sub.subOrderId}`, sub.subOrderId, sub.partnerId, sub.goodsAmount, sub.shippingFee, commission, netPayout));

    for (const it of sub.items) {
      const itemId = `item_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      batchStatements.push(env.DB.prepare(
        `INSERT INTO order_items (id, sub_order_id, sku_id, product_title, option_summary, unit_price, quantity, total_price)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(itemId, sub.subOrderId, it.skuId, it.title, it.optionSummary, it.unitPrice, it.quantity, it.lineTotal));

      batchStatements.push(env.DB.prepare(
        `UPDATE product_skus SET stock_quantity = stock_quantity - ?, status = CASE WHEN stock_quantity - ? <= 0 THEN 'OUT_OF_STOCK' ELSE status END WHERE id = ? AND stock_quantity >= ?`
      ).bind(it.quantity, it.quantity, it.skuId, it.quantity));

      const ledgerId = `ldg_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      const itemIdempotency = idempotencyKey ? `${idempotencyKey}_${it.skuId}` : `auto_${orderId}_${it.skuId}`;
      batchStatements.push(env.DB.prepare(
        `INSERT INTO inventory_ledger (id, sku_id, change_type, quantity_delta, balance_after, reference_id, idempotency_key)
         VALUES (?, ?, 'PURCHASE_DEDUCT', ?, ?, ?, ?)`
      ).bind(ledgerId, it.skuId, -it.quantity, it.currentStock - it.quantity, orderId, itemIdempotency));

      batchStatements.push(env.DB.prepare(
        'UPDATE products SET total_sold_count = total_sold_count + ? WHERE id = ?'
      ).bind(it.quantity, it.productId));
    }
  }

  await env.DB.batch(batchStatements);

  const responsePayload = {
    order_id: orderId, order_no: orderNo,
    total_goods_amount: totalGoods, total_shipping_amount: totalShipping, total_pay_amount: totalPay,
    sub_orders_created: subOrderCalculations.length, status: 'PAYMENT_CONFIRMED'
  };

  return new Response(JSON.stringify({
    success: true, brand: 'OLMOA', ...responsePayload, data: responsePayload
  }), { status: 201, headers: corsHeaders });
}
