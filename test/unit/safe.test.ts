import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  col,
  column,
  hasMany,
  id,
  isErr,
  isOk,
  safeDecompose,
  safeMapRows,
  table,
  variant,
  type MappingError,
  type Result,
} from '../../src'

const toUsers = safeMapRows({
  id: id<number>('user_id'),
  name: column<string>('user_name'),
  // A decoder that can reject, without pulling in a validation library.
  age: column('user_age', (v) => {
    if (typeof v !== 'number') throw new Error(`age must be a number, got ${typeof v}`)
    return v
  }),
})

describe('safeMapRows', () => {
  it('returns Ok with the mapped value on success', () => {
    const result = toUsers([{ user_id: 1, user_name: 'Alice', user_age: 30 }])
    expect(result).toEqual({ ok: true, value: [{ id: 1, name: 'Alice', age: 30 }] })
  })

  it('returns Err with a structured MappingError (with a field path)', () => {
    const result = toUsers([{ user_id: 1, user_name: 'Alice', user_age: 'oops' }])
    expect(result.ok).toBe(false)
    if (isErr(result)) {
      expect(result.error.message).toMatch(/age must be a number/)
      expect(result.error.path).toBe('[0].age')
      expect(result.error.cause).toBeInstanceOf(Error)
    }
  })

  it('reports a deep path into nested collections', () => {
    const toBlogs = safeMapRows({
      id: id<number>('user_id'),
      posts: hasMany({
        id: id<number>('post_id'),
        title: column('post_title', (v) => {
          if (typeof v !== 'string') throw new Error('title must be a string')
          return v
        }),
      }),
    })
    const result = toBlogs([
      { user_id: 1, post_id: 10, post_title: 'ok' },
      { user_id: 1, post_id: 11, post_title: 999 },
    ])
    expect(result.ok).toBe(false)
    if (isErr(result)) expect(result.error.path).toBe('[0].posts[1].title')
  })

  it('captures unknown-variant failures too, with a path', () => {
    const toOrders = safeMapRows({
      id: id<number>('order_id'),
      payment: variant('kind', 'kind', { card: { last4: column<string>('last4') } }),
    })
    const result = toOrders([{ order_id: 1, kind: 'crypto' }])
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/no variant case/)
      expect(result.error.path).toBe('[0].payment')
    }
  })

  it('narrows the union through `.ok` / isOk', () => {
    const result = toUsers([])
    if (isOk(result)) {
      expectTypeOf(result.value).toEqualTypeOf<{ id: number; name: string; age: number }[]>()
    } else {
      expectTypeOf(result.error).toEqualTypeOf<MappingError>()
    }
  })
})

describe('safeDecompose', () => {
  const orderTable = table('orders', { pk: 'id' }, {
    id: col<number>('id'),
    at: col<Date>('created_at', (d) => d.toISOString()),
  })
  const toTables = safeDecompose(orderTable)

  it('returns Ok on success', () => {
    const result = toTables([{ id: 1, at: new Date('2026-01-01T00:00:00.000Z') }])
    expect(result).toEqual({
      ok: true,
      value: { orders: [{ id: 1, created_at: '2026-01-01T00:00:00.000Z' }] },
    })
  })

  it('returns Err with a path when an encoder throws', () => {
    const result = toTables([{ id: 1, at: 'not a date' as unknown as Date }])
    expect(result.ok).toBe(false)
    if (isErr(result)) expect(result.error.path).toBe('orders.at')
  })
})

// Interop: converting to another library at the boundary needs no dependency.
// neverthrow: const r = res.ok ? okNT(res.value) : errNT(res.error)
// fp-ts:      const e  = res.ok ? right(res.value) : left(res.error)
function _interopExample(res: Result<number[]>): { tag: 'right' | 'left' } {
  return res.ok ? { tag: 'right' } : { tag: 'left' }
}
void _interopExample
