import { describe, expect, it } from 'vitest'
import {
  column,
  compute,
  hasMany,
  hasOne,
  id,
  mapRows,
  type Row,
} from '../../src'

/**
 * A single table-driven case: run `map` over `rows` and assert deep equality
 * with `expected`. Output types are heterogeneous across cases, so the case
 * shape is intentionally loose (`unknown`) while every schema itself stays
 * fully typed at its definition site.
 */
interface Case {
  readonly name: string
  readonly map: (rows: readonly Row[]) => unknown
  readonly rows: readonly Row[]
  readonly expected: unknown
}

const runCases = (cases: readonly Case[]) =>
  it.each(cases)('$name', ({ map, rows, expected }) => {
    expect(map(rows)).toEqual(expected)
  })

// ---------------------------------------------------------------------------

describe('one-to-many grouping', () => {
  const toUsers = mapRows({
    id: id<number>('user_id'),
    name: column<string>('user_name'),
    posts: hasMany({
      id: id<number>('post_id'),
      title: column<string>('post_title'),
    }),
  })

  runCases([
    {
      name: 'single parent with a single child',
      map: toUsers,
      rows: [{ user_id: 1, user_name: 'Alice', post_id: 10, post_title: 'A' }],
      expected: [{ id: 1, name: 'Alice', posts: [{ id: 10, title: 'A' }] }],
    },
    {
      name: 'single parent with multiple children',
      map: toUsers,
      rows: [
        { user_id: 1, user_name: 'Alice', post_id: 10, post_title: 'A' },
        { user_id: 1, user_name: 'Alice', post_id: 11, post_title: 'B' },
      ],
      expected: [
        {
          id: 1,
          name: 'Alice',
          posts: [
            { id: 10, title: 'A' },
            { id: 11, title: 'B' },
          ],
        },
      ],
    },
    {
      name: 'multiple parents',
      map: toUsers,
      rows: [
        { user_id: 1, user_name: 'Alice', post_id: 10, post_title: 'A' },
        { user_id: 2, user_name: 'Bob', post_id: 20, post_title: 'B' },
      ],
      expected: [
        { id: 1, name: 'Alice', posts: [{ id: 10, title: 'A' }] },
        { id: 2, name: 'Bob', posts: [{ id: 20, title: 'B' }] },
      ],
    },
    {
      name: 'empty input yields empty array',
      map: toUsers,
      rows: [],
      expected: [],
    },
  ])
})

describe('outer-join misses', () => {
  const toUsers = mapRows({
    id: id<number>('user_id'),
    name: column<string>('user_name'),
    posts: hasMany({
      id: id<number>('post_id'),
      title: column<string>('post_title'),
    }),
  })

  runCases([
    {
      name: 'null child ids collapse to an empty collection',
      map: toUsers,
      rows: [{ user_id: 3, user_name: 'Carol', post_id: null, post_title: null }],
      expected: [{ id: 3, name: 'Carol', posts: [] }],
    },
    {
      name: 'undefined child ids also collapse to an empty collection',
      map: toUsers,
      rows: [{ user_id: 3, user_name: 'Carol' }],
      expected: [{ id: 3, name: 'Carol', posts: [] }],
    },
    {
      name: 'mixes present and missing children across parents',
      map: toUsers,
      rows: [
        { user_id: 1, user_name: 'Alice', post_id: 10, post_title: 'A' },
        { user_id: 2, user_name: 'Bob', post_id: null, post_title: null },
      ],
      expected: [
        { id: 1, name: 'Alice', posts: [{ id: 10, title: 'A' }] },
        { id: 2, name: 'Bob', posts: [] },
      ],
    },
  ])
})

describe('deduplication and ordering', () => {
  const toUsers = mapRows({
    id: id<number>('user_id'),
    name: column<string>('user_name'),
    posts: hasMany({
      id: id<number>('post_id'),
      title: column<string>('post_title'),
    }),
  })

  runCases([
    {
      name: 'identical repeated rows are deduplicated',
      map: toUsers,
      rows: [
        { user_id: 1, user_name: 'Alice', post_id: 10, post_title: 'A' },
        { user_id: 1, user_name: 'Alice', post_id: 10, post_title: 'A' },
      ],
      expected: [{ id: 1, name: 'Alice', posts: [{ id: 10, title: 'A' }] }],
    },
    {
      name: 'first-seen order of parents and children is preserved',
      map: toUsers,
      rows: [
        { user_id: 2, user_name: 'Bob', post_id: 20, post_title: 'x' },
        { user_id: 1, user_name: 'Alice', post_id: 11, post_title: 'y' },
        { user_id: 1, user_name: 'Alice', post_id: 10, post_title: 'z' },
      ],
      expected: [
        { id: 2, name: 'Bob', posts: [{ id: 20, title: 'x' }] },
        {
          id: 1,
          name: 'Alice',
          posts: [
            { id: 11, title: 'y' },
            { id: 10, title: 'z' },
          ],
        },
      ],
    },
  ])
})

describe('hasOne (nullable one-to-one)', () => {
  const toUsers = mapRows({
    id: id<number>('user_id'),
    profile: hasOne({
      id: id<number>('profile_id'),
      bio: column<string>('profile_bio'),
    }),
  })

  runCases([
    {
      name: 'present relation becomes an object',
      map: toUsers,
      rows: [{ user_id: 1, profile_id: 5, profile_bio: 'hi' }],
      expected: [{ id: 1, profile: { id: 5, bio: 'hi' } }],
    },
    {
      name: 'missing relation becomes null',
      map: toUsers,
      rows: [{ user_id: 2, profile_id: null, profile_bio: null }],
      expected: [{ id: 2, profile: null }],
    },
    {
      name: 'when several identities appear, the first one wins',
      map: toUsers,
      rows: [
        { user_id: 1, profile_id: 5, profile_bio: 'first' },
        { user_id: 1, profile_id: 6, profile_bio: 'second' },
      ],
      expected: [{ id: 1, profile: { id: 5, bio: 'first' } }],
    },
  ])
})

describe('deep nesting (three levels)', () => {
  const toUsers = mapRows({
    id: id<number>('user_id'),
    posts: hasMany({
      id: id<number>('post_id'),
      title: column<string>('post_title'),
      comments: hasMany({
        id: id<number>('comment_id'),
        body: column<string>('comment_body'),
      }),
    }),
  })

  runCases([
    {
      name: 'nests users -> posts -> comments with a childless post',
      map: toUsers,
      rows: [
        { user_id: 1, post_id: 10, post_title: 'P', comment_id: 100, comment_body: 'c1' },
        { user_id: 1, post_id: 10, post_title: 'P', comment_id: 101, comment_body: 'c2' },
        { user_id: 1, post_id: 11, post_title: 'Q', comment_id: null, comment_body: null },
      ],
      expected: [
        {
          id: 1,
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
      ],
    },
  ])
})

describe('cartesian products from sibling collections', () => {
  const toUsers = mapRows({
    id: id<number>('user_id'),
    posts: hasMany({ id: id<number>('post_id'), title: column<string>('post_title') }),
    roles: hasMany({ id: id<number>('role_id'), name: column<string>('role_name') }),
  })

  runCases([
    {
      name: '2 posts x 2 roles (4 rows) un-inflate to 2 + 2',
      map: toUsers,
      rows: [
        { user_id: 1, post_id: 10, post_title: 'p1', role_id: 100, role_name: 'admin' },
        { user_id: 1, post_id: 10, post_title: 'p1', role_id: 101, role_name: 'editor' },
        { user_id: 1, post_id: 11, post_title: 'p2', role_id: 100, role_name: 'admin' },
        { user_id: 1, post_id: 11, post_title: 'p2', role_id: 101, role_name: 'editor' },
      ],
      expected: [
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
      ],
    },
  ])
})

describe('decoders and computed fields', () => {
  const toEvents = mapRows({
    id: id<string>('event_id', (v) => String(v)),
    at: column('created_at', (v) => new Date(v as string)),
    active: column('is_active', (v) => v === 1 || v === true),
    label: compute<string>((row) => `${row.kind}:${row.event_id}`),
  })

  runCases([
    {
      name: 'applies id decoders, column decoders and row-level compute',
      map: toEvents,
      rows: [
        { event_id: 42, created_at: '2020-01-01T00:00:00Z', is_active: 1, kind: 'click' },
      ],
      expected: [
        {
          id: '42',
          at: new Date('2020-01-01T00:00:00Z'),
          active: true,
          label: 'click:42',
        },
      ],
    },
    {
      name: 'a plain column without a decoder passes the raw value through',
      map: mapRows({ id: id<number>('id'), raw: column('payload') }),
      rows: [{ id: 1, payload: { nested: true } }],
      expected: [{ id: 1, raw: { nested: true } }],
    },
  ])
})

describe('composite identity keys', () => {
  const toPairs = mapRows({
    org: id<number | string>('org_id'),
    user: id<number | string>('user_id'),
    tags: hasMany({ id: id<string>('tag'), value: column<string>('tag') }),
  })

  runCases([
    {
      name: 'groups by the tuple of identity columns',
      map: toPairs,
      rows: [
        { org_id: 1, user_id: 1, tag: 'x' },
        { org_id: 1, user_id: 2, tag: 'y' },
        { org_id: 1, user_id: 1, tag: 'z' },
      ],
      expected: [
        { org: 1, user: 1, tags: [{ id: 'x', value: 'x' }, { id: 'z', value: 'z' }] },
        { org: 1, user: 2, tags: [{ id: 'y', value: 'y' }] },
      ],
    },
    {
      name: 'does not collide across value types (number 1 vs string "1")',
      map: toPairs,
      rows: [
        { org_id: 1, user_id: 1, tag: 'x' },
        { org_id: '1', user_id: '1', tag: 'y' },
      ],
      expected: [
        { org: 1, user: 1, tags: [{ id: 'x', value: 'x' }] },
        { org: '1', user: '1', tags: [{ id: 'y', value: 'y' }] },
      ],
    },
  ])
})

describe('root-level edge cases', () => {
  const toUsers = mapRows({
    id: id<number>('user_id'),
    name: column<string>('user_name'),
  })

  runCases([
    {
      name: 'rows whose root identity is null are dropped',
      map: toUsers,
      rows: [
        { user_id: null, user_name: 'ghost' },
        { user_id: 1, user_name: 'Alice' },
      ],
      expected: [{ id: 1, name: 'Alice' }],
    },
    {
      name: 'all-null root rows yield an empty result',
      map: toUsers,
      rows: [{ user_id: null, user_name: 'ghost' }],
      expected: [],
    },
  ])
})

describe('validation', () => {
  interface ThrowCase {
    readonly name: string
    readonly build: () => unknown
    readonly message: RegExp
  }

  it.each<ThrowCase>([
    {
      name: 'root schema without an id() column',
      build: () => mapRows({ name: column<string>('name') }),
      message: /root schema must declare at least one id\(\)/,
    },
    {
      name: 'nested collection without an id() column',
      build: () =>
        mapRows({
          id: id<number>('user_id'),
          posts: hasMany({ title: column<string>('post_title') }),
        })([{ user_id: 1, post_title: 'x' }]),
      message: /collection schema must declare at least one id\(\)/,
    },
    {
      name: 'nested single without an id() column',
      build: () =>
        mapRows({
          id: id<number>('user_id'),
          profile: hasOne({ bio: column<string>('bio') }),
        })([{ user_id: 1, bio: 'x' }]),
      message: /single schema must declare at least one id\(\)/,
    },
  ])('throws for $name', ({ build, message }) => {
    expect(build).toThrow(message)
  })
})
