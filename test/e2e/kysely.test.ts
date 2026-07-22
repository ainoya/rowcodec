import Database from 'better-sqlite3'
import { Kysely, SqliteDialect } from 'kysely'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DDL, sampleOrders, toOrders } from './orderAggregate'

// kysely database types matching the DDL.
interface OrdersTable {
  id: number
  customer_name: string
  status: string
  placed_at: string
}
interface OrderLinesTable {
  id: number
  order_id: number
  sku: string
  quantity: number
  unit_price_cents: number
}
interface ShipmentsTable {
  id: number
  order_id: number
  carrier: string
  tracking_code: string
}
interface DB {
  orders: OrdersTable
  order_lines: OrderLinesTable
  shipments: ShipmentsTable
}

let sqlite: Database.Database
let db: Kysely<DB>

beforeEach(async () => {
  sqlite = new Database(':memory:')
  sqlite.exec(DDL)
  db = new Kysely<DB>({ dialect: new SqliteDialect({ database: sqlite }) })

  // Seed the normalized tables from the domain aggregate.
  await db
    .insertInto('orders')
    .values(
      sampleOrders.map((o) => ({
        id: o.id,
        customer_name: o.customerName,
        status: o.status,
        placed_at: o.placedAt.toISOString(),
      })),
    )
    .execute()

  const lines = sampleOrders.flatMap((o) =>
    o.lines.map((l) => ({
      id: l.id,
      order_id: o.id,
      sku: l.sku,
      quantity: l.quantity,
      unit_price_cents: l.unitPriceCents,
    })),
  )
  if (lines.length) await db.insertInto('order_lines').values(lines).execute()

  const shipments = sampleOrders
    .filter((o) => o.shipment)
    .map((o) => ({
      id: o.shipment!.id,
      order_id: o.id,
      carrier: o.shipment!.carrier,
      tracking_code: o.shipment!.trackingCode,
    }))
  if (shipments.length) await db.insertInto('shipments').values(shipments).execute()
})

afterEach(async () => {
  await db.destroy()
})

describe('e2e: kysely left joins -> domain aggregate', () => {
  it('reconstructs the full aggregate from flat joined rows', async () => {
    const rows = await db
      .selectFrom('orders')
      .leftJoin('order_lines', 'order_lines.order_id', 'orders.id')
      .leftJoin('shipments', 'shipments.order_id', 'orders.id')
      .select([
        'orders.id as o_id',
        'orders.customer_name as o_customer',
        'orders.status as o_status',
        'orders.placed_at as o_placed_at',
        'order_lines.id as l_id',
        'order_lines.sku as l_sku',
        'order_lines.quantity as l_qty',
        'order_lines.unit_price_cents as l_price',
        'shipments.id as s_id',
        'shipments.carrier as s_carrier',
        'shipments.tracking_code as s_tracking',
      ])
      .orderBy('orders.id')
      .orderBy('order_lines.id')
      .execute()

    expect(toOrders(rows)).toEqual(sampleOrders)
  })

  it('filters to a single aggregate without losing its children', async () => {
    const rows = await db
      .selectFrom('orders')
      .leftJoin('order_lines', 'order_lines.order_id', 'orders.id')
      .leftJoin('shipments', 'shipments.order_id', 'orders.id')
      .select([
        'orders.id as o_id',
        'orders.customer_name as o_customer',
        'orders.status as o_status',
        'orders.placed_at as o_placed_at',
        'order_lines.id as l_id',
        'order_lines.sku as l_sku',
        'order_lines.quantity as l_qty',
        'order_lines.unit_price_cents as l_price',
        'shipments.id as s_id',
        'shipments.carrier as s_carrier',
        'shipments.tracking_code as s_tracking',
      ])
      .where('orders.id', '=', 1)
      .orderBy('order_lines.id')
      .execute()

    expect(toOrders(rows)).toEqual([sampleOrders[0]])
  })
})
