import type { OutputOf, Schema } from './spec'

/**
 * Invariant type equality. Unlike `extends`, this distinguishes `X | null` from
 * `X | undefined` and rejects excess properties, so it catches the subtle
 * mismatches that matter when binding a schema to an externally-defined domain
 * type (e.g. one produced by `z.infer`).
 */
type Equals<A, B> =
  (<G>() => G extends A ? 1 : 2) extends <G>() => G extends B ? 1 : 2 ? true : false

/** Shown at the call site when a schema's output drifts from the target type. */
interface TypeMismatch<S extends Schema, T> {
  readonly __rowcodecError: 'schema output does not exactly match the target type'
  readonly actual: OutputOf<S>
  readonly expected: T
}

/**
 * Bind a schema to an externally-defined domain type `T` (type-first).
 *
 * The domain type stays the source of truth — hand-written, or `z.infer<...>`
 * from a zod schema — and the mapping schema is checked against it. If
 * `OutputOf<schema>` does not *exactly* equal `T`, the schema argument fails to
 * type-check, pointing at the drift.
 *
 * @example
 * import { z } from 'zod'
 *
 * const User = z.object({
 *   id: z.number(),
 *   name: z.string(),
 *   posts: z.array(z.object({ id: z.number(), title: z.string() })),
 * })
 * type User = z.infer<typeof User>
 *
 * const userSchema = schemaFor<User>()({
 *   id: id<number>('user_id'),
 *   name: column<string>('user_name'),
 *   posts: hasMany({ id: id<number>('post_id'), title: column<string>('post_title') }),
 * })
 *
 * const toUsers = mapRows(userSchema)   // (rows) => User[]
 * const toRows = flattenRows(userSchema)
 */
export function schemaFor<T>() {
  return <S extends Schema>(
    schema: Equals<OutputOf<S>, T> extends true ? S : S & TypeMismatch<S, T>,
  ): S => schema
}
