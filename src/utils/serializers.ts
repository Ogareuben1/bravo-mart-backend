// ============================================================================
// BRAVOMART - DATA SERIALIZERS & DTO TRANSFORMERS
// ============================================================================
// Converts raw Prisma database entities (e.g. Prisma.Decimal, relative paths) 
// into serialized, frontend-safe JSON responses with numbers and absolute URLs.

import type { Category, Product, VendorProfile } from '../generated/prisma/client.js';
import type { Cart, CartItem, Order, Shipment, OrderItem, DispatchRiderProfile } from '../generated/prisma/client.js';
import { env } from '../config/env.js';

type VendorSummary = Pick<VendorProfile, 'id' | 'shopName' | 'shopAddress'>;

export interface ProductWithRelations extends Product {
  category: Category;
  vendor: VendorSummary;
}

export interface ProductResponse extends Omit<ProductWithRelations, 'price' | 'weightKg'> {
  price: number;
  weightKg: number;
}

/**
 * Base server URL resolution for transforming relative `/uploads/...` paths
 * into full, cross-origin accessible HTTP URLs (e.g., http://localhost:5000/uploads/...).
 * Checks process.env safely to prevent TypeScript env schema type mismatches.
 */
const BASE_SERVER_URL = 
  process.env.API_BASE_URL || 
  process.env.APP_URL || 
  `http://localhost:${env.PORT || 5000}`;

/**
 * Formats a product relative image path into a full HTTP URL if needed.
 */
function resolveImageUrl(imageUrl: string | null | undefined): string {
  if (!imageUrl) {
    return `${BASE_SERVER_URL}/uploads/products/placeholder.jpg`;
  }
  
  // If the path is relative (e.g., '/uploads/products/xyz.jpg'), prepend backend host
  if (imageUrl.startsWith('/')) {
    return `${BASE_SERVER_URL}${imageUrl}`;
  }
  
  if (!imageUrl.startsWith('http://') && !imageUrl.startsWith('https://')) {
    return `${BASE_SERVER_URL}/${imageUrl}`;
  }

  return imageUrl;
}

/**
 * Transforms Prisma Product model (with Decimal fields and relative image URLs)
 * into a frontend-safe response object.
 */
export function toProductResponse(product: ProductWithRelations): ProductResponse {
  return {
    ...product,
    price: Number(product.price),
    weightKg: Number(product.weightKg),
    imageUrl: resolveImageUrl(product.imageUrl),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Cart
// ─────────────────────────────────────────────────────────────────────────

type CartItemWithProduct = CartItem & { product: ProductWithRelations };

export interface CartItemResponse extends Omit<CartItemWithProduct, 'product'> {
  product: ProductResponse;
  lineTotal: number;
}

export interface CartResponse extends Omit<Cart, 'items'> {
  items: CartItemResponse[];
  itemCount: number;
  subtotal: number;
}

/**
 * Computes `lineTotal`/`subtotal` from the product's CURRENT price on every read.
 */
export function toCartResponse(cart: Cart & { items: CartItemWithProduct[] }): CartResponse {
  const items = cart.items.map((item) => {
    const product = toProductResponse(item.product);
    return { ...item, product, lineTotal: product.price * item.quantity };
  });

  return {
    ...cart,
    items,
    itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
    subtotal: items.reduce((sum, item) => sum + item.lineTotal, 0),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Orders & shipments
// ─────────────────────────────────────────────────────────────────────────

export interface OrderItemResponse extends Omit<OrderItem, 'priceSnapshot' | 'weightKgSnapshot' | 'lineTotal'> {
  priceSnapshot: number;
  weightKgSnapshot: number;
  lineTotal: number;
}

function toOrderItemResponse(item: OrderItem): OrderItemResponse {
  return {
    ...item,
    priceSnapshot: Number(item.priceSnapshot),
    weightKgSnapshot: Number(item.weightKgSnapshot),
    lineTotal: Number(item.lineTotal),
  };
}

type ShipmentWithRelations = Shipment & {
  items: OrderItem[];
  dispatchRider?: DispatchRiderProfile | null;
  vendor?: VendorSummary;
};

export interface ShipmentResponse
  extends Omit<ShipmentWithRelations, 'distanceKm' | 'weightKg' | 'itemsTotal' | 'shippingFee' | 'items' | 'dispatchRider'> {
  distanceKm: number;
  weightKg: number;
  itemsTotal: number;
  shippingFee: number;
  items: OrderItemResponse[];
  dispatchRider: DispatchRiderSummary | null;
}

export type DispatchRiderSummary = Pick<DispatchRiderProfile, 'id' | 'vehicleType'> & {
  fullName: string;
  phone: string | null;
};

function toShipmentResponse(
  shipment: ShipmentWithRelations,
  riderSummary: DispatchRiderSummary | null,
): ShipmentResponse {
  const { dispatchRider: _dispatchRider, ...rest } = shipment;
  return {
    ...rest,
    distanceKm: Number(shipment.distanceKm),
    weightKg: Number(shipment.weightKg),
    itemsTotal: Number(shipment.itemsTotal),
    shippingFee: Number(shipment.shippingFee),
    items: shipment.items.map(toOrderItemResponse),
    dispatchRider: riderSummary,
  };
}

type OrderWithRelations = Order & { shipments: ShipmentWithRelations[] };

export interface OrderResponse
  extends Omit<OrderWithRelations, 'subtotal' | 'shippingTotal' | 'platformFeeTotal' | 'grandTotal' | 'shipments'> {
  subtotal: number;
  shippingTotal: number;
  platformFeeTotal: number;
  grandTotal: number;
  shipments: ShipmentResponse[];
}

/**
 * Serializes Order entity and attached Shipment relations.
 */
export function toOrderResponse(
  order: OrderWithRelations,
  riderSummaries: Map<string, DispatchRiderSummary> = new Map(),
): OrderResponse {
  return {
    ...order,
    subtotal: Number(order.subtotal),
    shippingTotal: Number(order.shippingTotal),
    platformFeeTotal: Number(order.platformFeeTotal),
    grandTotal: Number(order.grandTotal),
    shipments: order.shipments.map((shipment) => toShipmentResponse(shipment, riderSummaries.get(shipment.id) ?? null)),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Dispatch riders
// ─────────────────────────────────────────────────────────────────────────

export interface DispatchRiderResponse extends Omit<DispatchRiderProfile, 'walletBalance' | 'rating'> {
  walletBalance: number;
  rating: number;
}

export function toDispatchRiderResponse(rider: DispatchRiderProfile): DispatchRiderResponse {
  return { ...rider, walletBalance: Number(rider.walletBalance), rating: Number(rider.rating) };
}