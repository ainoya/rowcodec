import { describe, expectTypeOf, it } from 'vitest'
import {
  column,
  compute,
  hasMany,
  hasOne,
  id,
  mapRows,
  type Infer,
} from '../../src'

describe('type inference', () => {
  it('infers a nested domain type from the schema', () => {
    const schema = {
      id: id<number>('user_id'),
      name: column<string>('user_name'),
      score: compute<number>((row) => Number(row.score)),
      profile: hasOne({ id: id<number>('pid'), bio: column<string>('bio') }),
      posts: hasMany({ id: id<number>('post_id'), title: column<string>('post_title') }),
    }

    type User = Infer<typeof schema>

    expectTypeOf<User>().toEqualTypeOf<{
      id: number
      name: string
      score: number
      profile: { id: number; bio: string } | null
      posts: { id: number; title: string }[]
    }>()
  })

  it('mapRows returns an array of the inferred type', () => {
    const toUsers = mapRows({
      id: id<number>('user_id'),
      name: column<string>('user_name'),
    })

    expectTypeOf(toUsers).returns.toEqualTypeOf<{ id: number; name: string }[]>()
  })

  it('a decoder narrows the column type', () => {
    const spec = {
      id: id<number>('id'),
      at: column('created_at', (v) => new Date(v as string)),
    }

    expectTypeOf<Infer<typeof spec>>().toEqualTypeOf<{ id: number; at: Date }>()
  })
})
