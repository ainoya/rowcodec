import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  column,
  flattenRows,
  hasMany,
  hasOne,
  id,
  mapRows,
  schemaFor,
  type Row,
} from '../../src'

/**
 * The domain type is the source of truth. In a real app this is typically
 * `type User = z.infer<typeof UserSchema>`; a hand-written interface exercises
 * the exact same binding mechanism.
 */
interface User {
  id: number
  name: string
  profile: { id: number; bio: string } | null
  posts: { id: number; title: string }[]
}

const userSchema = schemaFor<User>()({
  id: id<number>('user_id'),
  name: column<string>('user_name'),
  profile: hasOne({ id: id<number>('profile_id'), bio: column<string>('profile_bio') }),
  posts: hasMany({ id: id<number>('post_id'), title: column<string>('post_title') }),
})

describe('schemaFor - type-first binding', () => {
  it('produces a mapper whose output is exactly the domain type', () => {
    const toUsers = mapRows(userSchema)
    expectTypeOf(toUsers).returns.toEqualTypeOf<User[]>()

    const rows: Row[] = [
      { user_id: 1, user_name: 'Alice', profile_id: 9, profile_bio: 'hi', post_id: 10, post_title: 'A' },
      { user_id: 1, user_name: 'Alice', profile_id: 9, profile_bio: 'hi', post_id: 11, post_title: 'B' },
    ]

    const users: User[] = toUsers(rows)
    expect(users).toEqual([
      {
        id: 1,
        name: 'Alice',
        profile: { id: 9, bio: 'hi' },
        posts: [
          { id: 10, title: 'A' },
          { id: 11, title: 'B' },
        ],
      },
    ])
  })

  it('round-trips through the same bound schema', () => {
    const toUsers = mapRows(userSchema)
    const toRows = flattenRows(userSchema)
    const users: User[] = [
      { id: 2, name: 'Bob', profile: null, posts: [{ id: 20, title: 'x' }] },
    ]
    expect(toUsers(toRows(users))).toEqual(users)
  })
})

/**
 * Compile-time drift checks. Never executed — `tsc` (run via `pnpm typecheck`)
 * verifies each `@ts-expect-error` actually fires, so a schema that silently
 * drifts from `User` fails the build.
 */
function _driftIsRejected() {
  // Missing field (`posts` absent).
  // @ts-expect-error - schema output is missing `posts`
  schemaFor<User>()({
    id: id<number>('user_id'),
    name: column<string>('user_name'),
    profile: hasOne({ id: id<number>('profile_id'), bio: column<string>('profile_bio') }),
  })

  // Wrong column type (`name` typed as number).
  // @ts-expect-error - `name` should be string, not number
  schemaFor<User>()({
    id: id<number>('user_id'),
    name: column<number>('user_name'),
    profile: hasOne({ id: id<number>('profile_id'), bio: column<string>('profile_bio') }),
    posts: hasMany({ id: id<number>('post_id'), title: column<string>('post_title') }),
  })

  // nullable vs optional mismatch: `hasOne` yields `X | null`, not `X | undefined`.
  interface WithOptionalProfile {
    id: number
    profile?: { id: number; bio: string }
  }
  // @ts-expect-error - `X | null` from hasOne does not match `X | undefined`
  schemaFor<WithOptionalProfile>()({
    id: id<number>('user_id'),
    profile: hasOne({ id: id<number>('profile_id'), bio: column<string>('profile_bio') }),
  })

  // Extra field not present on the domain type.
  // @ts-expect-error - schema output has an extra `extra` field
  schemaFor<User>()({
    id: id<number>('user_id'),
    name: column<string>('user_name'),
    profile: hasOne({ id: id<number>('profile_id'), bio: column<string>('profile_bio') }),
    posts: hasMany({ id: id<number>('post_id'), title: column<string>('post_title') }),
    extra: column<string>('whatever'),
  })
}
void _driftIsRejected
