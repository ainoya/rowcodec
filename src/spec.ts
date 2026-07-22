/**
 * A flat database row as returned by an ORM/query builder (kysely, Prisma raw,
 * Drizzle, knex, node-postgres, ...). Keys are column aliases, values are the
 * raw column values.
 */
export type Row = Record<string, unknown>

/** A single column pulled from a row, optionally decoded into `T`. */
export interface ColumnSpec<T> {
  readonly _tag: 'column'
  /** Whether this column participates in the identity (grouping) key. */
  readonly _id: boolean
  readonly name: string
  /**
   * Decoder from the raw column value to `T`. When omitted, the raw value is
   * passed through unchanged (the declared `T` is then an unchecked promise
   * from the caller about the column's runtime type).
   */
  readonly decode?: (value: unknown) => T
  /**
   * Encoder from `T` back to a raw column value, used by `flattenRows` for the
   * reverse (domain -> rows) direction. When omitted, the value is passed
   * through unchanged. Declared with method syntax so a `ColumnSpec<T>` stays
   * assignable to `ColumnSpec<unknown>` despite `T` being an input here.
   */
  encode?(value: T): unknown
  /** Phantom carrier for the output type. Never read at runtime. */
  readonly _out?: T
}

/** A bidirectional column transform: `decode` for reads, `encode` for writes. */
export interface Codec<T> {
  readonly decode?: (value: unknown) => T
  readonly encode?: (value: T) => unknown
}

/** A value derived from the whole row rather than a single column. */
export interface ComputeSpec<T> {
  readonly _tag: 'compute'
  readonly fn: (row: Row) => T
  readonly _out?: T
}

/** A nested one-to-many relation, decoded into an array. */
export interface CollectionSpec<S extends Schema> {
  readonly _tag: 'collection'
  readonly schema: S
  readonly _out?: ReadonlyArray<OutputOf<S>>
}

/** A nested one-to-one relation, decoded into an object or `null`. */
export interface SingleSpec<S extends Schema> {
  readonly _tag: 'single'
  readonly schema: S
  readonly _out?: OutputOf<S> | null
}

/**
 * An embedded value object: several columns of the current row grouped into a
 * required, non-nullable object with no identity of its own (e.g. `Money`,
 * `Address`, `DateRange`). Unlike `hasOne` it needs no `id()` and is never
 * `null`; unlike `compute` it is fully reversible by `flattenRows`.
 */
export interface EmbedSpec<S extends Schema> {
  readonly _tag: 'embed'
  readonly schema: S
  readonly _out?: OutputOf<S>
}

/**
 * An optional embedded value object: like `embed`, but decodes to `null` when
 * every column of the value object is `null` (an absent optional VO, e.g. an
 * optional shipping address). Reverses symmetrically: `null` writes all-null
 * columns.
 */
export interface OptionalEmbedSpec<S extends Schema> {
  readonly _tag: 'optionalEmbed'
  readonly schema: S
  readonly _out?: OutputOf<S> | null
}

/** A map of discriminant tag -> the schema to build for that tag. */
export type VariantCases = { readonly [tag: string]: Schema }

/**
 * A discriminated union: a column selects which case schema to build, and the
 * chosen tag is emitted as a literal on the `as` field. Output is the union of
 * `{ [as]: tag } & OutputOf<case>` over every tag.
 */
export interface VariantSpec<D extends string, M extends VariantCases> {
  readonly _tag: 'variant'
  /** Row column whose value chooses the case. */
  readonly discriminator: string
  /** Output field name that carries the literal tag (the discriminant). */
  readonly as: D
  readonly cases: M
  // No `_out` phantom: the union output would put `D`/`M` in a position that
  // breaks `VariantSpec<...>` assignability to the `AnySpec` union. `SpecOutput`
  // recovers the type by inferring `D`/`M` from `as`/`cases` instead.
}

/**
 * An optional discriminated union: like `variant`, but decodes to `null` when
 * the discriminator column is `null` (e.g. a left-joined polymorphic relation
 * that is absent). Output is `VariantOutput | null`.
 */
export interface OptionalVariantSpec<D extends string, M extends VariantCases> {
  readonly _tag: 'optionalVariant'
  readonly discriminator: string
  readonly as: D
  readonly cases: M
}

type Prettify<T> = { [K in keyof T]: T[K] } & {}

/** The discriminated-union output type produced by a `VariantSpec`. */
export type VariantOutput<D extends string, M extends VariantCases> = {
  [K in keyof M & string]: Prettify<{ [P in D]: K } & OutputOf<M[K]>>
}[keyof M & string]

export type AnySpec =
  | ColumnSpec<unknown>
  | ComputeSpec<unknown>
  | CollectionSpec<Schema>
  | SingleSpec<Schema>
  | EmbedSpec<Schema>
  | OptionalEmbedSpec<Schema>
  | VariantSpec<string, VariantCases>
  | OptionalVariantSpec<string, VariantCases>

/** A description of the shape to build from a group of rows. */
export type Schema = { readonly [key: string]: AnySpec }

/** Resolve the output type produced by a single spec node. */
export type SpecOutput<Sp> =
  Sp extends ColumnSpec<infer T>
    ? T
    : Sp extends ComputeSpec<infer T>
      ? T
      : Sp extends CollectionSpec<infer S>
        ? OutputOf<S>[]
        : Sp extends SingleSpec<infer S>
          ? OutputOf<S> | null
          : Sp extends EmbedSpec<infer S>
            ? OutputOf<S>
            : Sp extends OptionalEmbedSpec<infer S>
              ? OutputOf<S> | null
              : Sp extends VariantSpec<infer D, infer M>
                ? VariantOutput<D, M>
                : Sp extends OptionalVariantSpec<infer D, infer M>
                  ? VariantOutput<D, M> | null
                  : never

/** Resolve the object type produced by a whole schema. */
export type OutputOf<S extends Schema> = {
  [K in keyof S]: SpecOutput<S[K]>
}

/**
 * The inferred domain type for a schema.
 *
 * @example
 * const userSchema = { id: id<number>('user_id'), name: column<string>('name') }
 * type User = Infer<typeof userSchema>
 */
export type Infer<S extends Schema> = OutputOf<S>

function makeColumn<T>(
  isId: boolean,
  name: string,
  arg: ((value: unknown) => T) | Codec<T> | undefined,
): ColumnSpec<T> {
  const codec: Codec<T> = typeof arg === 'function' ? { decode: arg } : (arg ?? {})
  const base = { _tag: 'column', _id: isId, name } satisfies Omit<
    ColumnSpec<T>,
    'decode' | 'encode' | '_out'
  >
  const withDecode = codec.decode ? { ...base, decode: codec.decode } : base
  return codec.encode ? { ...withDecode, encode: codec.encode } : withDecode
}

/**
 * Declare an identity column. Identity columns form the grouping key for a
 * level and are used to detect absent rows produced by outer joins: when every
 * identity column of a nested level is `null`/`undefined`, that relation is
 * treated as "no matching row" (skipped for `hasMany`, `null` for `hasOne`).
 */
export function id<T = unknown>(name: string, decode?: (value: unknown) => T): ColumnSpec<T>
export function id<T = unknown>(name: string, codec: Codec<T>): ColumnSpec<T>
export function id<T = unknown>(
  name: string,
  arg?: ((value: unknown) => T) | Codec<T>,
): ColumnSpec<T> {
  return makeColumn(true, name, arg)
}

/**
 * Declare a plain column. The second argument is either a `decode` function or
 * a `{ decode, encode }` codec (supply `encode` when you also use
 * `flattenRows` for the reverse direction).
 */
export function column<T = unknown>(name: string, decode?: (value: unknown) => T): ColumnSpec<T>
export function column<T = unknown>(name: string, codec: Codec<T>): ColumnSpec<T>
export function column<T = unknown>(
  name: string,
  arg?: ((value: unknown) => T) | Codec<T>,
): ColumnSpec<T> {
  return makeColumn(false, name, arg)
}

/** Derive a field from the whole row (e.g. combine columns). */
export function compute<T>(fn: (row: Row) => T): ComputeSpec<T> {
  return { _tag: 'compute', fn }
}

/** Declare a nested one-to-many relation. The child schema must declare `id()`. */
export function hasMany<S extends Schema>(schema: S): CollectionSpec<S> {
  return { _tag: 'collection', schema }
}

/** Declare a nested one-to-one relation. The child schema must declare `id()`. */
export function hasOne<S extends Schema>(schema: S): SingleSpec<S> {
  return { _tag: 'single', schema }
}

/**
 * Declare an embedded value object: a required, non-nullable object built from
 * columns of the current row, with no identity of its own. Use for multi-column
 * value objects such as `Money`, `Address`, or `DateRange`.
 *
 * @example
 * total: embed({
 *   amountCents: column<number>('total_amount'),
 *   currency: column<string>('total_currency'),
 * })
 * // -> { amountCents: number; currency: string }   (never null, round-trips)
 */
export function embed<S extends Schema>(schema: S): EmbedSpec<S> {
  return { _tag: 'embed', schema }
}

/**
 * Declare an optional embedded value object: like {@link embed}, but decodes to
 * `null` when every column of the value object is `null`. Use for optional
 * multi-column value objects such as an optional `Address`.
 */
export function optionalEmbed<S extends Schema>(schema: S): OptionalEmbedSpec<S> {
  return { _tag: 'optionalEmbed', schema }
}

/**
 * Declare a discriminated union. `discriminator` is the row column whose value
 * selects a case; `as` is the output field that carries the literal tag; each
 * entry of `cases` is the schema built for that tag. The output type is the
 * union of `{ [as]: tag } & Infer<case>`.
 *
 * @example
 * payment: variant('payment_kind', 'kind', {
 *   card: { last4: column<string>('card_last4') },
 *   bank: { iban: column<string>('bank_iban') },
 * })
 * // -> { kind: 'card'; last4: string } | { kind: 'bank'; iban: string }
 */
export function variant<const D extends string, M extends VariantCases>(
  discriminator: string,
  as: D,
  cases: M,
): VariantSpec<D, M> {
  return { _tag: 'variant', discriminator, as, cases }
}

/**
 * Declare an optional discriminated union. Like {@link variant}, but decodes to
 * `null` when the discriminator column is `null` (an absent polymorphic
 * relation). Output type is `Infer<union> | null`.
 */
export function optionalVariant<const D extends string, M extends VariantCases>(
  discriminator: string,
  as: D,
  cases: M,
): OptionalVariantSpec<D, M> {
  return { _tag: 'optionalVariant', discriminator, as, cases }
}
