import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { column, flattenRows, hasMany, id, mapRows, schemaFor, variant, type Row } from '../../src'

/**
 * Combining rowcodec with a zod-defined domain model — with no dependency from
 * rowcodec on zod. The zod schema is the single source of truth for both the
 * TYPE (via `z.infer`) and RUNTIME validation (via `.parse`).
 *
 * Domain ids are modelled as branded types (`z.number().brand()`), as is common
 * in real codebases; rowcodec binds to them through `schemaFor`.
 */
const UserId = z.number().brand<'UserId'>()
const PostId = z.number().brand<'PostId'>()

const PostSchema = z.object({ id: PostId, title: z.string() })
const UserSchema = z.object({
  id: UserId,
  name: z.string(),
  createdAt: z.date(),
  posts: z.array(PostSchema),
})

type UserId = z.infer<typeof UserId>
type PostId = z.infer<typeof PostId>
type User = z.infer<typeof UserSchema>

// Type-first: the mapping schema is bound to `z.infer<typeof UserSchema>`,
// including the branded id types.
const userSchema = schemaFor<User>()({
  id: id<UserId>('user_id'),
  name: column<string>('user_name'),
  createdAt: column('created_at', {
    decode: (v) => new Date(String(v)),
    encode: (d: Date) => d.toISOString(),
  }),
  posts: hasMany({
    id: id<PostId>('post_id'),
    // Field-level runtime validation: reuse zod as the column decoder.
    title: column('post_title', (v) => z.string().parse(v)),
  }),
})

const toUsers = mapRows(userSchema)
const toRows = flattenRows(userSchema)

describe('e2e: rowcodec + zod domain model (branded ids, dependency-free)', () => {
  const rows: Row[] = [
    { user_id: 1, user_name: 'Alice', created_at: '2026-01-01T00:00:00.000Z', post_id: 10, post_title: 'A' },
    { user_id: 1, user_name: 'Alice', created_at: '2026-01-01T00:00:00.000Z', post_id: 11, post_title: 'B' },
  ]

  it('maps rows and validates the aggregate with zod', () => {
    // rowcodec builds the nested shape; zod validates it at runtime.
    const users = toUsers(rows).map((u) => UserSchema.parse(u))

    expect(users).toEqual([
      {
        id: 1,
        name: 'Alice',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        posts: [
          { id: 10, title: 'A' },
          { id: 11, title: 'B' },
        ],
      },
    ])
  })

  it('round-trips the domain model back to rows and forward again', () => {
    const users = toUsers(rows) // branded User[], no casts needed
    expect(toUsers(toRows(users))).toEqual(users)
  })

  it('rejects malformed rows through the zod-backed decoder', () => {
    const badRows: Row[] = [
      { user_id: 1, user_name: 'Alice', created_at: '2026-01-01T00:00:00.000Z', post_id: 10, post_title: 123 },
    ]
    expect(() => toUsers(badRows)).toThrow()
  })
})

describe('e2e: rowcodec + zod discriminated union', () => {
  // A zod `discriminatedUnion` is the source of truth; `variant` binds to it.
  const Payment = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('card'), last4: z.string() }),
    z.object({ kind: z.literal('bank'), iban: z.string() }),
  ])
  const Order = z.object({ id: z.number(), payment: Payment })
  type Order = z.infer<typeof Order>

  const orderSchema = schemaFor<Order>()({
    id: id<number>('order_id'),
    payment: variant('payment_kind', 'kind', {
      card: { last4: column<string>('card_last4') },
      bank: { iban: column<string>('bank_iban') },
    }),
  })

  const toOrders = mapRows(orderSchema)
  const toOrderRows = flattenRows(orderSchema)

  it('maps each discriminated case and validates with zod', () => {
    const rows: Row[] = [
      { order_id: 1, payment_kind: 'card', card_last4: '4242', bank_iban: null },
      { order_id: 2, payment_kind: 'bank', card_last4: null, bank_iban: 'DE00' },
    ]
    const orders = toOrders(rows).map((o) => Order.parse(o))
    expect(orders).toEqual([
      { id: 1, payment: { kind: 'card', last4: '4242' } },
      { id: 2, payment: { kind: 'bank', iban: 'DE00' } },
    ])
  })

  it('round-trips the discriminated union back to rows', () => {
    const orders = toOrders([
      { order_id: 1, payment_kind: 'card', card_last4: '4242', bank_iban: null },
    ])
    expect(toOrders(toOrderRows(orders))).toEqual(orders)
  })
})
