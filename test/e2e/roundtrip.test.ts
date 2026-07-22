import { describe, expect, it } from 'vitest'
import { flattenOrders, sampleOrders, toOrders } from './orderAggregate'

/**
 * Pure (no database) bidirectional check: domain -> flat rows -> domain.
 * This isolates rowcodec's mapping from any ORM behaviour.
 */
describe('domain <-> row round-trip', () => {
  it('reconstructs the exact domain objects from flattened rows', () => {
    const rows = flattenOrders(sampleOrders)
    expect(toOrders(rows)).toEqual(sampleOrders)
  })

  it('is idempotent across a second round-trip', () => {
    const once = toOrders(flattenOrders(sampleOrders))
    const twice = toOrders(flattenOrders(once))
    expect(twice).toEqual(once)
  })
})
