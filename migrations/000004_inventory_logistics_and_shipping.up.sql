-- 000004_inventory_logistics_and_shipping.up.sql
-- Warehouses, Multi-location Inventory, Carts, and Logistics Tracking

CREATE TABLE IF NOT EXISTS warehouses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    partner_id UUID NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
    name VARCHAR(120) NOT NULL,
    postal_code VARCHAR(20) NOT NULL,
    road_address VARCHAR(255) NOT NULL,
    contact_phone VARCHAR(30) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS inventory_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sku_id UUID NOT NULL REFERENCES product_skus(id) ON DELETE RESTRICT,
    warehouse_id UUID REFERENCES warehouses(id) ON DELETE SET NULL,
    movement_type VARCHAR(30) NOT NULL CHECK (movement_type IN ('INBOUND', 'OUTBOUND_ORDER', 'ADJUSTMENT', 'RETURN_INBOUND')),
    quantity_change INT NOT NULL,
    balance_after INT NOT NULL,
    reference_id UUID,
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS inventory_reservations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sku_id UUID NOT NULL REFERENCES product_skus(id) ON DELETE RESTRICT,
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    reserved_quantity INT NOT NULL CHECK (reserved_quantity > 0),
    status VARCHAR(20) NOT NULL DEFAULT 'RESERVED' CHECK (status IN ('RESERVED', 'COMMITTED', 'RELEASED')),
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS carts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    guest_session_id VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_cart_user UNIQUE (user_id),
    CONSTRAINT uq_cart_guest UNIQUE (guest_session_id)
);

CREATE TABLE IF NOT EXISTS cart_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cart_id UUID NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
    sku_id UUID NOT NULL REFERENCES product_skus(id) ON DELETE RESTRICT,
    quantity INT NOT NULL CHECK (quantity > 0),
    is_selected BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (cart_id, sku_id)
);

CREATE TABLE IF NOT EXISTS wishlists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, product_id)
);

CREATE TABLE IF NOT EXISTS shipping_carriers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(30) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    tracking_url_template TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS shipments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sub_order_id UUID NOT NULL REFERENCES sub_orders(id) ON DELETE CASCADE,
    carrier_id UUID REFERENCES shipping_carriers(id) ON DELETE RESTRICT,
    tracking_number VARCHAR(100) NOT NULL,
    shipped_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    estimated_delivery_at TIMESTAMPTZ,
    actual_delivery_at TIMESTAMPTZ,
    status VARCHAR(30) NOT NULL DEFAULT 'IN_TRANSIT' CHECK (status IN ('LABEL_CREATED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'FAILED'))
);

CREATE TABLE IF NOT EXISTS shipment_tracking_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shipment_id UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
    event_timestamp TIMESTAMPTZ NOT NULL,
    location VARCHAR(120),
    status_description VARCHAR(255) NOT NULL,
    raw_payload JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
