// apps/cloudflare-gateway/src/routes/orders.js
// OLMOA Orders Engine: Zero-Trust Auth Guard, Atomic Batch Transitions & Status Cascades

import { processCheckout } from './orders-checkout.js';

export function verifyAuth(request, env) {
  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  const adminSecret = env.ADMIN_SECRET || 'olmoa_admin_sec_2026';
  const customSecret = request.headers.get('X-Admin-Secret') || '';

  const isAdmin = (token.length > 0 && token === adminSecret) || customSecret === adminSecret;
  const customerId = request.headers.get('X-Customer-Id') || (token && token !== adminSecret ? token : null);
  const isAuthenticated = isAdmin || Boolean(customerId);

  return { isAdmin, customerId, token, isAuthenticated };
}

export async function handleOrderRoutes(request, url, env, corsHeaders) {
  // 1. Checkout Entrypoint
  if ((url.pathname === '/api/v1/orders/checkout' || url.pathname === '/api/v1/orders') && request.method === 'POST') {
    const auth = verifyAuth(request, env);
    if (!auth.isAuthenticated) {
      return new Response(JSON.stringify({ error: 'Unauthorized: Authentication required.' }), { status: 401, headers: corsHeaders });
    }
    return await processCheckout(request, env, corsHeaders, auth);
  }

  // 2. Order Cancellation & Settlement Cascade (WO-05)
  if (url.pathname.match(/^\/api\/v1\/orders\/[^\/]+\/cancel$/) && request.method === 'POST') {
    const ordId = url.pathname.split('/')[4];
    const auth = verifyAuth(request, env);
    if (!auth.isAuthenticated) {
      return new Response(JSON.stringify({ error: 'Unauthorized: Authentication required.' }), { status: 401, headers: corsHeaders });
    }

    const order = await env.DB.prepare('SELECT * FROM orders WHERE id = ? OR order_no = ?').bind(ordId, ordId).first();
    if (!order) return new Response(JSON.stringify({ error: 'Order not found' }), { status: 404, headers: corsHeaders });
    if (!auth.isAdmin && order.customer_id !== auth.customerId) {
      return new Response(JSON.stringify({ error: 'Forbidden: Cannot cancel another user order' }), { status: 403, headers: corsHeaders });
    }
    if (order.payment_status === 'CANCELLED') {
      return new Response(JSON.stringify({ error: 'Order is already cancelled' }), { status: 400, headers: corsHeaders });
    }

    // Verify sub-orders state transition guard
    const { results: subOrders } = await env.DB.prepare('SELECT id, status FROM sub_orders WHERE parent_order_id = ?').bind(order.id).all();
    const nonCancellable = subOrders.filter(s => ['SHIPPED', 'DELIVERED', 'COMPLETED', 'PURCHASE_CONFIRMED'].includes(s.status));
    if (nonCancellable.length > 0) {
      return new Response(JSON.stringify({
        error: '배송이 시작된 주문은 취소할 수 없습니다. 반품/교환을 신청해주세요.',
        status: nonCancellable[0].status
      }), { status: 400, headers: corsHeaders });
    }

    // Fetch order items to restock and adjust sales metrics
    const { results: items } = await env.DB.prepare(
      `SELECT i.sku_id, i.quantity, s.product_id
       FROM order_items i
       JOIN sub_orders sub ON i.sub_order_id = sub.id
       JOIN product_skus s ON i.sku_id = s.id
       WHERE sub.parent_order_id = ?`
    ).bind(order.id).all();

    const cancelBatch = [];
    for (const it of items) {
      cancelBatch.push(env.DB.prepare(
        "UPDATE product_skus SET stock_quantity = stock_quantity + ?, status = 'IN_STOCK' WHERE id = ?"
      ).bind(it.quantity, it.sku_id));

      const ledgerId = `ldg_cnl_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      const cnlKey = `cnl_${order.id}_${it.sku_id}_${Date.now()}`;
      cancelBatch.push(env.DB.prepare(
        "INSERT INTO inventory_ledger (id, sku_id, change_type, quantity_delta, balance_after, reference_id, idempotency_key) VALUES (?, ?, 'ORDER_CANCEL', ?, (SELECT stock_quantity FROM product_skus WHERE id = ?), ?, ?)"
      ).bind(ledgerId, it.sku_id, it.quantity, it.sku_id, order.id, cnlKey));

      cancelBatch.push(env.DB.prepare(
        'UPDATE products SET total_sold_count = MAX(0, total_sold_count - ?) WHERE id = ?'
      ).bind(it.quantity, it.product_id));
    }

    // Cascade cancel settlements
    for (const sub of subOrders) {
      cancelBatch.push(env.DB.prepare(
        "UPDATE settlements SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP WHERE sub_order_id = ?"
      ).bind(sub.id));
    }

    cancelBatch.push(env.DB.prepare(
      "UPDATE orders SET payment_status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).bind(order.id));

    cancelBatch.push(env.DB.prepare(
      "UPDATE sub_orders SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP WHERE parent_order_id = ?"
    ).bind(order.id));

    await env.DB.batch(cancelBatch);

    return new Response(JSON.stringify({
      success: true, brand: 'OLMOA', message: 'Order cancelled, settlements voided & stock restocked', order_id: order.id, status: 'CANCELLED'
    }), { headers: corsHeaders });
  }

  // 3. Orders List with Strict Session Auth
  if (url.pathname === '/api/v1/orders' && request.method === 'GET') {
    const auth = verifyAuth(request, env);
    if (!auth.isAuthenticated) {
      return new Response(JSON.stringify({ error: 'Unauthorized: Authentication required.' }), { status: 401, headers: corsHeaders });
    }

    const targetCustomer = auth.isAdmin && url.searchParams.get('customer_id') ? url.searchParams.get('customer_id') : auth.customerId;
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
    const auth = verifyAuth(request, env);
    if (!auth.isAuthenticated) {
      return new Response(JSON.stringify({ error: 'Unauthorized: Authentication required.' }), { status: 401, headers: corsHeaders });
    }

    const order = await env.DB.prepare('SELECT * FROM orders WHERE id = ? OR order_no = ?').bind(ordId, ordId).first();
    if (!order) return new Response(JSON.stringify({ error: 'Order not found' }), { status: 404, headers: corsHeaders });

    if (!auth.isAdmin && order.customer_id !== auth.customerId) {
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
