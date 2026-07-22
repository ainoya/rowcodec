import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  column,
  flattenRows,
  id,
  mapRows,
  optionalVariant,
  variant,
  type Infer,
  type Row,
} from '../../src'

const schema = {
  id: id<number>('id'),
  payment: optionalVariant('payment_kind', 'kind', {
    card: { last4: column<string>('card_last4') },
    bank: { iban: column<string>('bank_iban') },
  }),
}
const toRows = mapRows(schema)
const toFlat = flattenRows(schema)

describe('optionalVariant', () => {
  it('infers a nullable discriminated union', () => {
    expectTypeOf<Infer<typeof schema>['payment']>().toEqualTypeOf<
      { kind: 'card'; last4: string } | { kind: 'bank'; iban: string } | null
    >()
  })

  it('is null when the discriminator column is null (left-join miss)', () => {
    expect(toRows([{ id: 1, payment_kind: null, card_last4: null, bank_iban: null }])).toEqual([
      { id: 1, payment: null },
    ])
  })

  it('builds the active case when the discriminator is present', () => {
    expect(toRows([{ id: 2, payment_kind: 'card', card_last4: '4242', bank_iban: null }])).toEqual([
      { id: 2, payment: { kind: 'card', last4: '4242' } },
    ])
  })

  it('round-trips both present and absent', () => {
    const items = [
      { id: 1, payment: { kind: 'card' as const, last4: '4242' } },
      { id: 2, payment: null },
    ]
    expect(toRows(toFlat(items))).toEqual(items)
  })
})

describe('variant `as`-collision no longer clobbers the tag', () => {
  // A case column named the same as the discriminant field (`kind`).
  const s = {
    id: id<number>('id'),
    payment: variant('payment_kind', 'kind', {
      card: { kind: column<string>('brand'), last4: column<string>('l4') },
    }),
  }

  it('keeps the literal tag, matching the declared type', () => {
    const [row] = mapRows(s)([{ id: 1, payment_kind: 'card', brand: 'visa', l4: '4242' }])
    // Tag 'card' wins over the `brand` column value 'visa'.
    expect(row).toEqual({ id: 1, payment: { kind: 'card', last4: '4242' } })
  })
})
