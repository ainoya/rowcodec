import Database from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  col,
  column,
  decompose,
  embed,
  embedTable,
  flattenRows,
  hasMany,
  hasManyTable,
  id,
  mapRows,
  optionalEmbed,
  optionalVariant,
  table,
  type Row,
} from '../../src'

const DDL = `
CREATE TABLE orders (
  id             INTEGER PRIMARY KEY,
  total_amount   INTEGER NOT NULL,
  total_currency TEXT NOT NULL,
  ship_line1     TEXT,
  ship_postcode  TEXT,
  payment_kind   TEXT,
  card_last4     TEXT,
  bank_iban      TEXT
);
CREATE TABLE order_lines (
  id       INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL,
  sku      TEXT NOT NULL,
  qty      INTEGER NOT NULL
);
`

const orders = sqliteTable('orders', {
  id: integer('id').primaryKey(),
  totalAmount: integer('total_amount').notNull(),
  totalCurrency: text('total_currency').notNull(),
  shipLine1: text('ship_line1'),
  shipPostcode: text('ship_postcode'),
  paymentKind: text('payment_kind'),
  cardLast4: text('card_last4'),
  bankIban: text('bank_iban'),
})
const orderLines = sqliteTable('order_lines', {
  id: integer('id').primaryKey(),
  orderId: integer('order_id').notNull(),
  sku: text('sku').notNull(),
  qty: integer('qty').notNull(),
})

// Read schema exercising embed / optionalEmbed / optionalVariant / hasMany.
const orderSchema = {
  id: id<number>('o_id'),
  total: embed({
    amountCents: column<number>('o_total_amount'),
    currency: column<string>('o_total_currency'),
  }),
  shippingAddress: optionalEmbed({
    line1: column<string>('o_ship_line1'),
    postcode: column<string>('o_ship_postcode'),
  }),
  payment: optionalVariant('o_payment_kind', 'kind', {
    card: { last4: column<string>('o_card_last4') },
    bank: { iban: column<string>('o_bank_iban') },
  }),
  lines: hasMany({
    id: id<number>('l_id'),
    sku: column<string>('l_sku'),
    qty: column<number>('l_qty'),
  }),
}
const toOrders = mapRows(orderSchema)
const toRows = flattenRows(orderSchema)

const projection = {
  o_id: orders.id,
  o_total_amount: orders.totalAmount,
  o_total_currency: orders.totalCurrency,
  o_ship_line1: orders.shipLine1,
  o_ship_postcode: orders.shipPostcode,
  o_payment_kind: orders.paymentKind,
  o_card_last4: orders.cardLast4,
  o_bank_iban: orders.bankIban,
  l_id: orderLines.id,
  l_sku: orderLines.sku,
  l_qty: orderLines.qty,
}

let sqlite: Database.Database
let db: BetterSQLite3Database

const readAll = (): Row[] =>
  db
    .select(projection)
    .from(orders)
    .leftJoin(orderLines, eq(orderLines.orderId, orders.id))
    .orderBy(orders.id, orderLines.id)
    .all()

beforeEach(() => {
  sqlite = new Database(':memory:')
  sqlite.exec(DDL)
  db = drizzle(sqlite)
})

describe('e2e: drizzle joins -> rowcodec (embed / optionalEmbed / optionalVariant)', () => {
  const expected = [
    {
      id: 1,
      total: { amountCents: 1200, currency: 'JPY' },
      shippingAddress: { line1: '1 Main', postcode: '100-0001' },
      payment: { kind: 'card', last4: '4242' },
      lines: [
        { id: 10, sku: 'A', qty: 1 },
        { id: 11, sku: 'B', qty: 2 },
      ],
    },
    {
      id: 2,
      total: { amountCents: 300, currency: 'JPY' },
      shippingAddress: null,
      payment: null,
      lines: [],
    },
  ]

  beforeEach(() => {
    db.insert(orders)
      .values([
        {
          id: 1,
          totalAmount: 1200,
          totalCurrency: 'JPY',
          shipLine1: '1 Main',
          shipPostcode: '100-0001',
          paymentKind: 'card',
          cardLast4: '4242',
          bankIban: null,
        },
        {
          id: 2,
          totalAmount: 300,
          totalCurrency: 'JPY',
          shipLine1: null,
          shipPostcode: null,
          paymentKind: null,
          cardLast4: null,
          bankIban: null,
        },
      ])
      .run()
    db.insert(orderLines)
      .values([
        { id: 10, orderId: 1, sku: 'A', qty: 1 },
        { id: 11, orderId: 1, sku: 'B', qty: 2 },
      ])
      .run()
  })

  it('maps value objects, an optional address, an optional union, and lines', () => {
    expect(toOrders(readAll())).toEqual(expected)
  })

  it('round-trips the mapped aggregate through flattenRows', () => {
    const domain = toOrders(readAll())
    expect(toOrders(toRows(domain))).toEqual(domain)
  })
})

describe('e2e: rowcodec decompose -> drizzle read (full circle)', () => {
  // Persistence schema (decompose supports col / embedTable / hasManyTable).
  const orderTable = table('orders', { pk: 'id' }, {
    id: col<number>('id'),
    total: embedTable({
      amountCents: col<number>('total_amount'),
      currency: col<string>('total_currency'),
    }),
    lines: hasManyTable('order_lines', { pk: 'id', fk: 'order_id' }, {
      id: col<number>('id'),
      sku: col<string>('sku'),
      qty: col<number>('qty'),
    }),
  })

  it('decomposes an aggregate, inserts it, and reads it back identically', () => {
    const domain = [
      { id: 5, total: { amountCents: 999, currency: 'USD' }, lines: [{ id: 50, sku: 'Z', qty: 3 }] },
    ]

    // domain -> normalized rows -> INSERT (via the underlying sqlite handle).
    const tables = decompose(orderTable)(domain)
    for (const [name, rows] of Object.entries(tables)) {
      if (rows.length === 0) continue
      const cols = Object.keys(rows[0]!)
      const stmt = sqlite.prepare(
        `INSERT INTO ${name} (${cols.join(', ')}) VALUES (${cols.map((c) => `@${c}`).join(', ')})`,
      )
      for (const row of rows) stmt.run(row)
    }

    // read back through drizzle + rowcodec; untouched columns come back absent.
    expect(toOrders(readAll())).toEqual([
      {
        id: 5,
        total: { amountCents: 999, currency: 'USD' },
        shippingAddress: null,
        payment: null,
        lines: [{ id: 50, sku: 'Z', qty: 3 }],
      },
    ])
  })
})
