import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import { col, decompose, hasManyTable, hasOneTable, table, type Row } from '../../src'
import { DDL, sampleOrders, toOrders, type Order } from './orderAggregate'

// Persistence schema: unlike the read schema (column aliases), it knows each
// level's TABLE, primary key, and the foreign key linking child to parent.
const orderTable = table('orders', { pk: 'id' }, {
  id: col<number>('id'),
  customerName: col<string>('customer_name'),
  status: col<string>('status'),
  placedAt: col<Date>('placed_at', (d) => d.toISOString()),
  lines: hasManyTable('order_lines', { pk: 'id', fk: 'order_id' }, {
    id: col<number>('id'),
    sku: col<string>('sku'),
    quantity: col<number>('quantity'),
    unitPriceCents: col<number>('unit_price_cents'),
  }),
  shipment: hasOneTable('shipments', { pk: 'id', fk: 'order_id' }, {
    id: col<number>('id'),
    carrier: col<string>('carrier'),
    trackingCode: col<string>('tracking_code'),
  }),
})

const toTables = decompose(orderTable)

const JOIN_SQL = `
  SELECT o.id AS o_id, o.customer_name AS o_customer, o.status AS o_status, o.placed_at AS o_placed_at,
         l.id AS l_id, l.sku AS l_sku, l.quantity AS l_qty, l.unit_price_cents AS l_price,
         s.id AS s_id, s.carrier AS s_carrier, s.tracking_code AS s_tracking
  FROM orders o
  LEFT JOIN order_lines l ON l.order_id = o.id
  LEFT JOIN shipments s ON s.order_id = o.id
  ORDER BY o.id, l.id
`

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  db.exec(DDL)
})

describe('e2e: decompose -> INSERT -> read back', () => {
  it('produces INSERT-ready normalized rows that reconstruct the aggregate', () => {
    const orders: Order[] = sampleOrders

    // 1. domain -> normalized per-table rows.
    const tables = toTables(orders)

    // 2. INSERT each table (parent-first ordering satisfies FK constraints).
    for (const [name, rows] of Object.entries(tables)) {
      if (rows.length === 0) continue
      const cols = Object.keys(rows[0]!)
      const stmt = db.prepare(
        `INSERT INTO ${name} (${cols.join(', ')}) VALUES (${cols.map((c) => `@${c}`).join(', ')})`,
      )
      for (const row of rows) stmt.run(row)
    }

    // 3. read back through a join with the read schema -> identical domain.
    const readRows: Row[] = db.prepare(JOIN_SQL).all() as Row[]
    expect(toOrders(readRows)).toEqual(orders)
  })

  it('inserts each order exactly once despite multiple child rows', () => {
    toTables(sampleOrders).orders!.forEach((row) => {
      db.prepare('INSERT INTO orders (id, customer_name, status, placed_at) VALUES (@id, @customer_name, @status, @placed_at)').run(row)
    })
    const count = db.prepare('SELECT count(*) AS n FROM orders').get() as { n: number }
    expect(count.n).toBe(sampleOrders.length) // 3, not inflated by lines/shipments
  })
})
