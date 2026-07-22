import { describe, expect, it } from 'vitest'
import {
  column,
  flattenRows,
  hasMany,
  hasOne,
  id,
  mapRows,
  type Row,
} from '../../src'

// --- Schemas reused across the cases ---------------------------------------

const usersWithPosts = {
  id: id<number>('user_id'),
  name: column<string>('user_name'),
  posts: hasMany({ id: id<number>('post_id'), title: column<string>('post_title') }),
}

const usersWithProfile = {
  id: id<number>('user_id'),
  profile: hasOne({ id: id<number>('profile_id'), bio: column<string>('profile_bio') }),
}

const usersWithTwoCollections = {
  id: id<number>('user_id'),
  posts: hasMany({ id: id<number>('post_id'), title: column<string>('post_title') }),
  roles: hasMany({ id: id<number>('role_id'), name: column<string>('role_name') }),
}

const usersDeep = {
  id: id<number>('user_id'),
  name: column<string>('user_name'),
  posts: hasMany({
    id: id<number>('post_id'),
    title: column<string>('post_title'),
    comments: hasMany({
      id: id<number>('comment_id'),
      body: column<string>('comment_body'),
    }),
  }),
}

const eventsWithCodecs = {
  id: id<string>('event_id', { decode: (v) => String(v), encode: (s: string) => Number(s) }),
  at: column('created_at', {
    decode: (v) => new Date(v as string),
    encode: (d: Date) => d.toISOString(),
  }),
}

// ---------------------------------------------------------------------------

describe('flattenRows - exact flattened output', () => {
  interface Case {
    readonly name: string
    readonly run: () => Row[]
    readonly expected: Row[]
  }

  it.each<Case>([
    {
      name: 'one parent with two children expands to two rows',
      run: () =>
        flattenRows(usersWithPosts)([
          {
            id: 1,
            name: 'Alice',
            posts: [
              { id: 10, title: 'A' },
              { id: 11, title: 'B' },
            ],
          },
        ]),
      expected: [
        { user_id: 1, user_name: 'Alice', post_id: 10, post_title: 'A' },
        { user_id: 1, user_name: 'Alice', post_id: 11, post_title: 'B' },
      ],
    },
    {
      name: 'an empty collection becomes a single null-filled row',
      run: () => flattenRows(usersWithPosts)([{ id: 2, name: 'Bob', posts: [] }]),
      expected: [{ user_id: 2, user_name: 'Bob', post_id: null, post_title: null }],
    },
    {
      name: 'a present hasOne writes its columns',
      run: () =>
        flattenRows(usersWithProfile)([{ id: 1, profile: { id: 5, bio: 'hi' } }]),
      expected: [{ user_id: 1, profile_id: 5, profile_bio: 'hi' }],
    },
    {
      name: 'a null hasOne writes null columns',
      run: () => flattenRows(usersWithProfile)([{ id: 2, profile: null }]),
      expected: [{ user_id: 2, profile_id: null, profile_bio: null }],
    },
    {
      name: 'sibling collections expand to their cartesian product',
      run: () =>
        flattenRows(usersWithTwoCollections)([
          {
            id: 1,
            posts: [
              { id: 10, title: 'p1' },
              { id: 11, title: 'p2' },
            ],
            roles: [
              { id: 100, name: 'admin' },
              { id: 101, name: 'editor' },
            ],
          },
        ]),
      expected: [
        { user_id: 1, post_id: 10, post_title: 'p1', role_id: 100, role_name: 'admin' },
        { user_id: 1, post_id: 10, post_title: 'p1', role_id: 101, role_name: 'editor' },
        { user_id: 1, post_id: 11, post_title: 'p2', role_id: 100, role_name: 'admin' },
        { user_id: 1, post_id: 11, post_title: 'p2', role_id: 101, role_name: 'editor' },
      ],
    },
    {
      name: 'multi-level nesting flattens to any depth (users -> posts -> comments)',
      run: () =>
        flattenRows(usersDeep)([
          {
            id: 1,
            name: 'A',
            posts: [
              {
                id: 10,
                title: 'P',
                comments: [
                  { id: 100, body: 'c1' },
                  { id: 101, body: 'c2' },
                ],
              },
              { id: 11, title: 'Q', comments: [] },
            ],
          },
        ]),
      expected: [
        { user_id: 1, user_name: 'A', post_id: 10, post_title: 'P', comment_id: 100, comment_body: 'c1' },
        { user_id: 1, user_name: 'A', post_id: 10, post_title: 'P', comment_id: 101, comment_body: 'c2' },
        { user_id: 1, user_name: 'A', post_id: 11, post_title: 'Q', comment_id: null, comment_body: null },
      ],
    },
    {
      name: 'column encoders are applied in reverse',
      run: () =>
        flattenRows(eventsWithCodecs)([
          { id: '42', at: new Date('2020-01-01T00:00:00.000Z') },
        ]),
      expected: [{ event_id: 42, created_at: '2020-01-01T00:00:00.000Z' }],
    },
  ])('$name', ({ run, expected }) => {
    expect(run()).toEqual(expected)
  })
})

describe('flattenRows <-> mapRows round-trip', () => {
  interface RoundTripCase {
    readonly name: string
    readonly check: () => { actual: unknown; expected: unknown }
  }

  it.each<RoundTripCase>([
    {
      name: 'one-to-many with mixed empty/non-empty children',
      check: () => {
        const input = [
          {
            id: 1,
            name: 'Alice',
            posts: [
              { id: 10, title: 'A' },
              { id: 11, title: 'B' },
            ],
          },
          { id: 2, name: 'Bob', posts: [] },
        ]
        return { actual: mapRows(usersWithPosts)(flattenRows(usersWithPosts)(input)), expected: input }
      },
    },
    {
      name: 'nullable hasOne (present and absent)',
      check: () => {
        const input = [
          { id: 1, profile: { id: 5, bio: 'hi' } },
          { id: 2, profile: null },
        ]
        return {
          actual: mapRows(usersWithProfile)(flattenRows(usersWithProfile)(input)),
          expected: input,
        }
      },
    },
    {
      name: 'deep three-level nesting',
      check: () => {
        const input = [
          {
            id: 1,
            name: 'A',
            posts: [
              { id: 10, title: 'P', comments: [{ id: 100, body: 'c1' }] },
              { id: 11, title: 'Q', comments: [] },
            ],
          },
          { id: 2, name: 'B', posts: [] },
        ]
        return { actual: mapRows(usersDeep)(flattenRows(usersDeep)(input)), expected: input }
      },
    },
    {
      name: 'codecs survive a decode/encode/decode cycle',
      check: () => {
        const input = [{ id: '42', at: new Date('2020-01-01T00:00:00.000Z') }]
        return {
          actual: mapRows(eventsWithCodecs)(flattenRows(eventsWithCodecs)(input)),
          expected: input,
        }
      },
    },
  ])('$name', ({ check }) => {
    const { actual, expected } = check()
    expect(actual).toEqual(expected)
  })
})
