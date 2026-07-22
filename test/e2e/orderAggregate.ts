/**
 * A realistic aggregate shared by the kysely and drizzle e2e suites.
 *
 * Domain: an `Order` with many `OrderLine`s (one-to-many) and an optional
 * `Shipment` (nullable one-to-one). Both e2e suites persist this into a real
 * SQLite database, read it back through `LEFT JOIN`s, and reconstruct the
 * domain objects with rowcodec — exercising the flat-row -> aggregate direction
 * against actual ORM output.
 */
import { column, flattenRows, hasMany, hasOne, id, mapRows, schemaFor } from '../../src'

// --- Domain model ----------------------------------------------------------

export type OrderStatus = 'pending' | 'paid' | 'shipped'

export interface OrderLine {
  id: number
  sku: string
  quantity: number
  unitPriceCents: number
}

export interface Shipment {
  id: number
  carrier: string
  trackingCode: string
}

export interface Order {
  id: number
  customerName: string
  status: OrderStatus
  placedAt: Date
  lines: OrderLine[]
  shipment: Shipment | null
}

// --- rowcodec schema (keyed by the join query's column aliases) ------------

// Type-first: the schema is bound to the hand-written `Order` domain type via
// `schemaFor`, so any drift between the mapping and `Order` is a compile error.
export const orderSchema = schemaFor<Order>()({
  id: id<number>('o_id'),
  customerName: column<string>('o_customer'),
  status: column<OrderStatus>('o_status'),
  placedAt: column('o_placed_at', {
    decode: (v) => new Date(v as string),
    encode: (d: Date) => d.toISOString(),
  }),
  lines: hasMany({
    id: id<number>('l_id'),
    sku: column<string>('l_sku'),
    quantity: column<number>('l_qty'),
    unitPriceCents: column<number>('l_price'),
  }),
  shipment: hasOne({
    id: id<number>('s_id'),
    carrier: column<string>('s_carrier'),
    trackingCode: column<string>('s_tracking'),
  }),
})

export const toOrders = mapRows(orderSchema)

// --- Canonical dataset -----------------------------------------------------

export const PLACED_AT = new Date('2026-07-19T09:00:00.000Z')

/**
 * Three orders chosen to exercise every path:
 *  - #1: multiple lines + a shipment
 *  - #2: lines but no shipment (hasOne miss -> null)
 *  - #3: no lines and no shipment (hasMany miss -> [], hasOne miss -> null)
 */
export const sampleOrders: Order[] = [
  {
    id: 1,
    customerName: 'Alice',
    status: 'shipped',
    placedAt: PLACED_AT,
    lines: [
      { id: 10, sku: 'BOOK-1', quantity: 2, unitPriceCents: 1500 },
      { id: 11, sku: 'PEN-9', quantity: 5, unitPriceCents: 120 },
    ],
    shipment: { id: 100, carrier: 'yamato', trackingCode: 'TRK-1' },
  },
  {
    id: 2,
    customerName: 'Bob',
    status: 'paid',
    placedAt: PLACED_AT,
    lines: [{ id: 20, sku: 'MUG-3', quantity: 1, unitPriceCents: 900 }],
    shipment: null,
  },
  {
    id: 3,
    customerName: 'Carol',
    status: 'pending',
    placedAt: PLACED_AT,
    lines: [],
    shipment: null,
  },
]

// --- SQL schema shared by both drivers -------------------------------------

export const DDL = `
CREATE TABLE orders (
  id           INTEGER PRIMARY KEY,
  customer_name TEXT NOT NULL,
  status       TEXT NOT NULL,
  placed_at    TEXT NOT NULL
);
CREATE TABLE order_lines (
  id               INTEGER PRIMARY KEY,
  order_id         INTEGER NOT NULL,
  sku              TEXT NOT NULL,
  quantity         INTEGER NOT NULL,
  unit_price_cents INTEGER NOT NULL
);
CREATE TABLE shipments (
  id            INTEGER PRIMARY KEY,
  order_id      INTEGER NOT NULL,
  carrier       TEXT NOT NULL,
  tracking_code TEXT NOT NULL
);
`

// --- Domain -> flat rows (the reverse direction, via the library) ----------

/**
 * The reverse mapper, built from the same schema. Expands domain `Order`s into
 * the flat, denormalized rows a `LEFT JOIN` would produce, so that
 * `toOrders(flattenOrders(x))` reproduces `x`.
 */
export const flattenOrders = flattenRows(orderSchema)
