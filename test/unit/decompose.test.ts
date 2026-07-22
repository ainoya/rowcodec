import { describe, expect, it } from 'vitest'
import { col, decompose, embedTable, hasManyTable, hasOneTable, table } from '../../src'

const orderTable = table('orders', { pk: 'id' }, {
  id: col<number>('id'),
  customerName: col<string>('customer_name'),
  // A value object embedded on the orders row.
  total: embedTable({
    amountCents: col<number>('total_amount'),
    currency: col<string>('total_currency'),
  }),
  lines: hasManyTable('order_lines', { pk: 'id', fk: 'order_id' }, {
    id: col<number>('id'),
    sku: col<string>('sku'),
  }),
  shipment: hasOneTable('shipments', { pk: 'id', fk: 'order_id' }, {
    id: col<number>('id'),
    carrier: col<string>('carrier'),
  }),
})

const toTables = decompose(orderTable)

describe('decompose - normalized rows', () => {
  it('emits one parent row per aggregate (no cartesian duplication) with FKs filled', () => {
    const result = toTables([
      {
        id: 1,
        customerName: 'Alice',
        total: { amountCents: 1200, currency: 'JPY' },
        lines: [
          { id: 10, sku: 'A' },
          { id: 11, sku: 'B' },
        ],
        shipment: { id: 100, carrier: 'yamato' },
      },
      {
        id: 2,
        customerName: 'Bob',
        total: { amountCents: 300, currency: 'JPY' },
        lines: [],
        shipment: null,
      },
    ])

    expect(result).toEqual({
      orders: [
        // embed columns merged into the row; parent appears exactly once each.
        { id: 1, customer_name: 'Alice', total_amount: 1200, total_currency: 'JPY' },
        { id: 2, customer_name: 'Bob', total_amount: 300, total_currency: 'JPY' },
      ],
      order_lines: [
        { order_id: 1, id: 10, sku: 'A' },
        { order_id: 1, id: 11, sku: 'B' },
      ],
      shipments: [{ order_id: 1, id: 100, carrier: 'yamato' }],
    })
  })

  it('omits empty collections and null relations entirely', () => {
    const result = toTables([
      { id: 3, customerName: 'Carol', total: { amountCents: 0, currency: 'JPY' }, lines: [], shipment: null },
    ])
    expect(result.order_lines).toBeUndefined()
    expect(result.shipments).toBeUndefined()
    expect(result.orders).toHaveLength(1)
  })

  it('applies column encoders', () => {
    const t = table('events', { pk: 'id' }, {
      id: col<number>('id'),
      at: col<Date>('created_at', (d) => d.toISOString()),
    })
    expect(decompose(t)([{ id: 1, at: new Date('2026-01-01T00:00:00.000Z') }])).toEqual({
      events: [{ id: 1, created_at: '2026-01-01T00:00:00.000Z' }],
    })
  })

  it('throws when the pk field is not a column', () => {
    const bad = table('t', { pk: 'nope' }, { id: col<number>('id') })
    expect(() => decompose(bad)([{ id: 1 }])).toThrow(/pk "nope"/)
  })
})
