import Ajv, { type JSONSchemaType } from 'ajv'
import { describe, expect, it } from 'vitest'
import { column, flattenRows, hasMany, id, mapRows, schemaFor, type Row } from '../../src'

/**
 * Combining rowcodec with an ajv-validated domain model — again with no
 * dependency from rowcodec on ajv. ajv validates the JSON structure at runtime;
 * the domain ids are branded types that exist only at compile time (ajv cannot
 * mint nominal brands), so the JSON Schema targets the structural shape.
 */
type UserId = number & { readonly __brand: 'UserId' }
type PostId = number & { readonly __brand: 'PostId' }

interface Post {
  id: PostId
  title: string
}
interface User {
  id: UserId
  name: string
  posts: Post[]
}

// The runtime JSON Schema describes the structural (unbranded) shape.
interface UserJson {
  id: number
  name: string
  posts: { id: number; title: string }[]
}
const userJsonSchema: JSONSchemaType<UserJson> = {
  type: 'object',
  properties: {
    id: { type: 'number' },
    name: { type: 'string' },
    posts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'number' },
          title: { type: 'string' },
        },
        required: ['id', 'title'],
        additionalProperties: false,
      },
    },
  },
  required: ['id', 'name', 'posts'],
  additionalProperties: false,
}

const ajv = new Ajv()
const validateUser = ajv.compile(userJsonSchema)

// Type-first: the mapping schema is bound to the branded `User` domain type.
const userSchema = schemaFor<User>()({
  id: id<UserId>('user_id'),
  name: column<string>('user_name'),
  posts: hasMany({
    id: id<PostId>('post_id'),
    title: column<string>('post_title'),
  }),
})

const toUsers = mapRows(userSchema)
const toRows = flattenRows(userSchema)

describe('e2e: rowcodec + ajv domain model (branded ids, dependency-free)', () => {
  const rows: Row[] = [
    { user_id: 1, user_name: 'Alice', post_id: 10, post_title: 'A' },
    { user_id: 1, user_name: 'Alice', post_id: 11, post_title: 'B' },
    { user_id: 2, user_name: 'Bob', post_id: null, post_title: null },
  ]

  it('maps rows and every aggregate passes ajv validation', () => {
    const users = toUsers(rows)

    for (const user of users) expect(validateUser(user)).toBe(true)
    expect(users).toEqual([
      {
        id: 1,
        name: 'Alice',
        posts: [
          { id: 10, title: 'A' },
          { id: 11, title: 'B' },
        ],
      },
      { id: 2, name: 'Bob', posts: [] },
    ])
  })

  it('round-trips the domain model back to rows and forward again', () => {
    const users = toUsers(rows)
    expect(toUsers(toRows(users))).toEqual(users)
  })

  it('ajv rejects a structurally invalid aggregate', () => {
    const badRows: Row[] = [{ user_id: 1, user_name: 'Alice', post_id: 10, post_title: 999 }]
    const [user] = toUsers(badRows)
    expect(validateUser(user)).toBe(false)
    expect(validateUser.errors).toBeTruthy()
  })
})
