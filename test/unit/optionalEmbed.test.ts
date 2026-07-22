import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  column,
  flattenRows,
  id,
  mapRows,
  optionalEmbed,
  schemaFor,
  type Infer,
  type Row,
} from '../../src'

interface Address {
  line1: string
  postcode: string
}
interface Customer {
  id: number
  shippingAddress: Address | null
}

const customerSchema = schemaFor<Customer>()({
  id: id<number>('customer_id'),
  shippingAddress: optionalEmbed({
    line1: column<string>('ship_line1'),
    postcode: column<string>('ship_postcode'),
  }),
})

const toCustomers = mapRows(customerSchema)
const toRows = flattenRows(customerSchema)

describe('optionalEmbed', () => {
  it('infers a nullable value object type (T | null)', () => {
    expectTypeOf<Infer<typeof customerSchema>['shippingAddress']>().toEqualTypeOf<Address | null>()
  })

  it('builds the value object when its columns are present', () => {
    expect(
      toCustomers([{ customer_id: 1, ship_line1: '1 Main St', ship_postcode: '1000001' }]),
    ).toEqual([{ id: 1, shippingAddress: { line1: '1 Main St', postcode: '1000001' } }])
  })

  it('is null when every column is null (no more type-lying)', () => {
    expect(
      toCustomers([{ customer_id: 2, ship_line1: null, ship_postcode: null }]),
    ).toEqual([{ id: 2, shippingAddress: null }])
  })

  it('round-trips both present and absent through flattenRows', () => {
    const customers = [
      { id: 1, shippingAddress: { line1: 'A', postcode: 'P' } },
      { id: 2, shippingAddress: null },
    ]
    expect(toCustomers(toRows(customers))).toEqual(customers)
  })

  it('absent VO writes all-null columns on the way out', () => {
    const rows: Row[] = toRows([{ id: 2, shippingAddress: null }])
    expect(rows).toEqual([{ customer_id: 2, ship_line1: null, ship_postcode: null }])
  })
})
