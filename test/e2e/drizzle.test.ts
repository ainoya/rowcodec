import Database from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { beforeEach, describe, expect, it } from 'vitest'
import { DDL, sampleOrders, toOrders } from './orderAggregate'

// drizzle table definitions matching the DDL.
const orders = sqliteTable('orders', {
  id: integer('id').primaryKey(),
  customerName: text('customer_name').notNull(),
  status: text('status').notNull(),
  placedAt: text('placed_at').notNull(),
})
const orderLines = sqliteTable('order_lines', {
  id: integer('id').primaryKey(),
  orderId: integer('order_id').notNull(),
  sku: text('sku').notNull(),
  quantity: integer('quantity').notNull(),
  unitPriceCents: integer('unit_price_cents').notNull(),
})
const shipments = sqliteTable('shipments', {
  id: integer('id').primaryKey(),
  orderId: integer('order_id').notNull(),
  carrier: text('carrier').notNull(),
  trackingCode: text('tracking_code').notNull(),
})

let db: BetterSQLite3Database

beforeEach(() => {
  const sqlite = new Database(':memory:')
  sqlite.exec(DDL)
  db = drizzle(sqlite)

  db.insert(orders)
    .values(
      sampleOrders.map((o) => ({
        id: o.id,
        customerName: o.customerName,
        status: o.status,
        placedAt: o.placedAt.toISOString(),
      })),
    )
    .run()

  const lines = sampleOrders.flatMap((o) =>
    o.lines.map((l) => ({
      id: l.id,
      orderId: o.id,
      sku: l.sku,
      quantity: l.quantity,
      unitPriceCents: l.unitPriceCents,
    })),
  )
  if (lines.length) db.insert(orderLines).values(lines).run()

  const shipmentRows = sampleOrders
    .filter((o) => o.shipment)
    .map((o) => ({
      id: o.shipment!.id,
      orderId: o.id,
      carrier: o.shipment!.carrier,
      trackingCode: o.shipment!.trackingCode,
    }))
  if (shipmentRows.length) db.insert(shipments).values(shipmentRows).run()
})

const joinProjection = {
  o_id: orders.id,
  o_customer: orders.customerName,
  o_status: orders.status,
  o_placed_at: orders.placedAt,
  l_id: orderLines.id,
  l_sku: orderLines.sku,
  l_qty: orderLines.quantity,
  l_price: orderLines.unitPriceCents,
  s_id: shipments.id,
  s_carrier: shipments.carrier,
  s_tracking: shipments.trackingCode,
}

describe('e2e: drizzle left joins -> domain aggregate', () => {
  it('reconstructs the full aggregate from flat joined rows', () => {
    const rows = db
      .select(joinProjection)
      .from(orders)
      .leftJoin(orderLines, eq(orderLines.orderId, orders.id))
      .leftJoin(shipments, eq(shipments.orderId, orders.id))
      .orderBy(orders.id, orderLines.id)
      .all()

    expect(toOrders(rows)).toEqual(sampleOrders)
  })

  it('reconstructs an order that has lines but no shipment', () => {
    const rows = db
      .select(joinProjection)
      .from(orders)
      .leftJoin(orderLines, eq(orderLines.orderId, orders.id))
      .leftJoin(shipments, eq(shipments.orderId, orders.id))
      .where(eq(orders.id, 2))
      .orderBy(orderLines.id)
      .all()

    expect(toOrders(rows)).toEqual([sampleOrders[1]])
  })

  it('reconstructs an order with neither lines nor shipment', () => {
    const rows = db
      .select(joinProjection)
      .from(orders)
      .leftJoin(orderLines, eq(orderLines.orderId, orders.id))
      .leftJoin(shipments, eq(shipments.orderId, orders.id))
      .where(eq(orders.id, 3))
      .all()

    expect(toOrders(rows)).toEqual([sampleOrders[2]])
  })
})
