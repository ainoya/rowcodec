import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  column,
  embed,
  hasMany,
  id,
  flattenRows,
  mapRows,
  schemaFor,
  type Infer,
  type Row,
} from '../../src'

// A required, identity-less, multi-column value object (Money), plus a nested
// value object (Address inside a Shipment line) to prove embeds compose.
interface Money {
  amountCents: number
  currency: string
}
interface Order {
  id: number
  total: Money
  lines: { id: number; price: Money }[]
}

const orderSchema = schemaFor<Order>()({
  id: id<number>('order_id'),
  total: embed({
    amountCents: column<number>('total_amount'),
    currency: column<string>('total_currency'),
  }),
  lines: hasMany({
    id: id<number>('line_id'),
    price: embed({
      amountCents: column<number>('line_amount'),
      currency: column<string>('line_currency'),
    }),
  }),
})

const toOrders = mapRows(orderSchema)
const toRows = flattenRows(orderSchema)

describe('embed - required value object', () => {
  it('infers a non-nullable object type (no spurious `| null`)', () => {
    expectTypeOf<Infer<typeof orderSchema>['total']>().toEqualTypeOf<Money>()
  })

  const rows: Row[] = [
    { order_id: 1, total_amount: 1200, total_currency: 'JPY', line_id: 10, line_amount: 500, line_currency: 'JPY' },
    { order_id: 1, total_amount: 1200, total_currency: 'JPY', line_id: 11, line_amount: 700, line_currency: 'JPY' },
  ]

  it('builds embedded value objects at the root and inside a collection', () => {
    expect(toOrders(rows)).toEqual([
      {
        id: 1,
        total: { amountCents: 1200, currency: 'JPY' },
        lines: [
          { id: 10, price: { amountCents: 500, currency: 'JPY' } },
          { id: 11, price: { amountCents: 700, currency: 'JPY' } },
        ],
      },
    ])
  })

  it('round-trips losslessly through flattenRows (unlike compute)', () => {
    const orders = toOrders(rows)
    const back = toRows(orders)
    expect(back).toEqual(rows)
    expect(toOrders(back)).toEqual(orders)
  })

  it('stays present even when a numeric field is 0', () => {
    const [order] = toOrders([
      { order_id: 2, total_amount: 0, total_currency: 'JPY', line_id: 20, line_amount: 0, line_currency: 'JPY' },
    ])
    expect(order?.total).toEqual({ amountCents: 0, currency: 'JPY' })
  })
})
