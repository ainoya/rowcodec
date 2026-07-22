import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  column,
  flattenRows,
  hasMany,
  id,
  mapRows,
  variant,
  type Infer,
  type Row,
} from '../../src'

// A user whose `payment` field is a discriminated union, plus a nested
// collection inside one of the cases to prove variants compose with relations.
const userSchema = {
  id: id<number>('user_id'),
  payment: variant('payment_kind', 'kind', {
    card: {
      last4: column<string>('card_last4'),
      brand: column<string>('card_brand'),
    },
    bank: {
      iban: column<string>('bank_iban'),
    },
    invoice: {
      terms: column<string>('invoice_terms'),
      installments: hasMany({
        id: id<number>('installment_id'),
        amountCents: column<number>('installment_amount'),
      }),
    },
  }),
}

const toUsers = mapRows(userSchema)
const toRows = flattenRows(userSchema)

describe('variant - type inference', () => {
  it('infers a discriminated union with the tag on `kind`', () => {
    type User = Infer<typeof userSchema>
    expectTypeOf<User['payment']>().toEqualTypeOf<
      | { kind: 'card'; last4: string; brand: string }
      | { kind: 'bank'; iban: string }
      | { kind: 'invoice'; terms: string; installments: { id: number; amountCents: number }[] }
    >()
  })
})

describe('variant - decode', () => {
  interface Case {
    readonly name: string
    readonly rows: readonly Row[]
    readonly expected: unknown
  }

  it.each<Case>([
    {
      name: 'selects the card case',
      rows: [{ user_id: 1, payment_kind: 'card', card_last4: '4242', card_brand: 'visa' }],
      expected: [{ id: 1, payment: { kind: 'card', last4: '4242', brand: 'visa' } }],
    },
    {
      name: 'selects the bank case',
      rows: [{ user_id: 2, payment_kind: 'bank', bank_iban: 'DE00' }],
      expected: [{ id: 2, payment: { kind: 'bank', iban: 'DE00' } }],
    },
    {
      name: 'selects the invoice case and nests its collection',
      rows: [
        { user_id: 3, payment_kind: 'invoice', invoice_terms: 'net30', installment_id: 1, installment_amount: 500 },
        { user_id: 3, payment_kind: 'invoice', invoice_terms: 'net30', installment_id: 2, installment_amount: 700 },
      ],
      expected: [
        {
          id: 3,
          payment: {
            kind: 'invoice',
            terms: 'net30',
            installments: [
              { id: 1, amountCents: 500 },
              { id: 2, amountCents: 700 },
            ],
          },
        },
      ],
    },
  ])('$name', ({ rows, expected }) => {
    expect(toUsers(rows)).toEqual(expected)
  })

  it('throws on an unknown discriminator value', () => {
    expect(() => toUsers([{ user_id: 9, payment_kind: 'crypto' }])).toThrow(/no variant case/)
  })
})

describe('variant - flatten (reverse) and round-trip', () => {
  it('nulls the inactive cases columns when flattening', () => {
    const rows = toRows([{ id: 1, payment: { kind: 'card', last4: '4242', brand: 'visa' } }])
    expect(rows).toEqual([
      {
        user_id: 1,
        payment_kind: 'card',
        card_last4: '4242',
        card_brand: 'visa',
        bank_iban: null,
        invoice_terms: null,
        installment_id: null,
        installment_amount: null,
      },
    ])
  })

  it('round-trips every case, including the nested collection', () => {
    const users = [
      { id: 1, payment: { kind: 'card' as const, last4: '4242', brand: 'visa' } },
      { id: 2, payment: { kind: 'bank' as const, iban: 'DE00' } },
      {
        id: 3,
        payment: {
          kind: 'invoice' as const,
          terms: 'net30',
          installments: [
            { id: 1, amountCents: 500 },
            { id: 2, amountCents: 700 },
          ],
        },
      },
    ]
    expect(toUsers(toRows(users))).toEqual(users)
  })
})
