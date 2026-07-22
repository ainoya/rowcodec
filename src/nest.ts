import type {
  ColumnSpec,
  OutputOf,
  Row,
  Schema,
  VariantCases,
  VariantSpec,
} from './spec'
import {
  ok,
  err,
  locate,
  RowcodecError,
  toMappingError,
  type MappingError,
  type Result,
} from './result'

/** An array proven to hold at least one element. */
type NonEmpty<T> = [T, ...T[]]

/** Collect the identity columns declared at a single schema level. */
function idColumns(schema: Schema): ColumnSpec<unknown>[] {
  const cols: ColumnSpec<unknown>[] = []
  for (const spec of Object.values(schema)) {
    if (spec._tag === 'column' && spec._id) cols.push(spec)
  }
  return cols
}

/** Stable, type-aware key part so `1` (number) and `"1"` (string) never collide. */
function keyPart(value: unknown): string {
  if (value === null || value === undefined) return ' n'
  return `${typeof value} ${String(value)}`
}

function identityKey(idCols: readonly ColumnSpec<unknown>[], row: Row): string {
  return idCols.map((c) => keyPart(row[c.name])).join('')
}

/** A row is "absent" when every identity column is null/undefined (outer join miss). */
function isAbsent(idCols: readonly ColumnSpec<unknown>[], row: Row): boolean {
  return idCols.every((c) => row[c.name] == null)
}

/** Group rows by their identity key while preserving first-seen order. */
function groupByIdentity(
  idCols: readonly ColumnSpec<unknown>[],
  rows: readonly Row[],
): NonEmpty<Row>[] {
  const groups = new Map<string, NonEmpty<Row>>()
  for (const row of rows) {
    const key = identityKey(idCols, row)
    const bucket = groups.get(key)
    if (bucket) bucket.push(row)
    else groups.set(key, [row])
  }
  return [...groups.values()]
}

function requireIdColumns(
  schema: Schema,
  where: string,
): ColumnSpec<unknown>[] {
  const cols = idColumns(schema)
  if (cols.length === 0) {
    throw new Error(
      `rowcodec: ${where} schema must declare at least one id() column so rows can be grouped.`,
    )
  }
  return cols
}

/**
 * rowcodec's single soundness boundary. A schema is walked at runtime and its
 * object assembled key-by-key, which TypeScript cannot correlate with the mapped
 * `OutputOf<S>` type. The unprovable "this record matches the schema" step is
 * isolated in this one overloaded helper — the public signature returns
 * `OutputOf<S>` while the implementation returns the loose record — so no `as`
 * cast is needed and every caller stays fully type-checked.
 */
function assembled<S extends Schema>(record: Record<string, unknown>): OutputOf<S>
function assembled(record: Record<string, unknown>): Record<string, unknown> {
  return record
}

/** Join a parent path with a child key for error reporting. */
function childPath(path: string, key: string): string {
  return path ? `${path}.${key}` : key
}

/** Every column reachable in a schema tree (for value-object absence checks). */
function reachableColumns(schema: Schema): ColumnSpec<unknown>[] {
  const cols: ColumnSpec<unknown>[] = []
  for (const spec of Object.values(schema)) {
    if (spec._tag === 'column') cols.push(spec)
    else if (
      spec._tag === 'embed' ||
      spec._tag === 'optionalEmbed' ||
      spec._tag === 'single' ||
      spec._tag === 'collection'
    ) {
      cols.push(...reachableColumns(spec.schema))
    } else if (spec._tag === 'variant' || spec._tag === 'optionalVariant') {
      for (const caseSchema of Object.values(spec.cases)) {
        cols.push(...reachableColumns(caseSchema))
      }
    }
  }
  return cols
}

/** Build a single object from a group of rows that share one identity. */
function buildObject<S extends Schema>(
  schema: S,
  rows: NonEmpty<Row>,
  path: string,
): OutputOf<S> {
  const [first] = rows
  const out: Record<string, unknown> = {}
  for (const [key, spec] of Object.entries(schema)) {
    const at = childPath(path, key)
    switch (spec._tag) {
      case 'column': {
        const raw = first[spec.name]
        if (spec.decode) {
          try {
            out[key] = spec.decode(raw)
          } catch (thrown) {
            throw locate(thrown, at)
          }
        } else {
          out[key] = raw
        }
        break
      }
      case 'compute':
        try {
          out[key] = spec.fn(first)
        } catch (thrown) {
          throw locate(thrown, at)
        }
        break
      case 'collection':
        out[key] = nestCollection(spec.schema, rows, at)
        break
      case 'single':
        out[key] = nestSingle(spec.schema, rows, at)
        break
      case 'embed':
        // A required value object: always built from the current row group,
        // no identity, never null.
        out[key] = buildObject(spec.schema, rows, at)
        break
      case 'optionalEmbed': {
        // An optional value object: null when all of its columns are null.
        const cols = reachableColumns(spec.schema)
        const absent = cols.length > 0 && cols.every((c) => first[c.name] == null)
        out[key] = absent ? null : buildObject(spec.schema, rows, at)
        break
      }
      case 'variant':
        out[key] = buildVariant(spec, rows, at)
        break
      case 'optionalVariant': {
        // An optional discriminated union: null when the discriminator is null.
        out[key] = first[spec.discriminator] == null ? null : buildVariant(spec, rows, at)
        break
      }
    }
  }
  return assembled<S>(out)
}

/** Build the active case of a discriminated union from a group of rows. */
function buildVariant(
  spec: { discriminator: string; as: string; cases: VariantCases },
  rows: NonEmpty<Row>,
  path: string,
): Record<string, unknown> {
  const [first] = rows
  const tag = String(first[spec.discriminator])
  const caseSchema = spec.cases[tag]
  if (caseSchema === undefined) {
    throw new RowcodecError(
      `rowcodec: no variant case for ${spec.discriminator}="${tag}" (known cases: ${Object.keys(spec.cases).join(', ')}).`,
      path,
    )
  }
  // The literal tag wins over any same-named case column, so runtime matches the
  // declared discriminated-union type.
  return { ...buildObject(caseSchema, rows, path), [spec.as]: tag }
}

/**
 * Build one node object from the group of rows that share its identity (used by
 * `tree`). The group may span several join rows, so the node schema can contain
 * its own `hasMany`/`hasOne`/`embed`/`variant`.
 */
export function buildNode<S extends Schema>(schema: S, rows: readonly Row[]): OutputOf<S> {
  const [first, ...rest] = rows
  if (first === undefined) {
    throw new RowcodecError('rowcodec: cannot build a tree node from an empty row group.', '')
  }
  return buildObject(schema, [first, ...rest], '')
}

/** Nest a group of rows into a one-to-many array. */
export function nestCollection<S extends Schema>(
  schema: S,
  rows: readonly Row[],
  path = '',
): OutputOf<S>[] {
  const idCols = requireIdColumns(schema, 'collection')
  const present = rows.filter((row) => !isAbsent(idCols, row))
  return groupByIdentity(idCols, present).map((group, index) =>
    buildObject(schema, group, `${path}[${index}]`),
  )
}

/** Nest a group of rows into a nullable one-to-one object. */
export function nestSingle<S extends Schema>(
  schema: S,
  rows: readonly Row[],
  path = '',
): OutputOf<S> | null {
  const idCols = requireIdColumns(schema, 'single')
  const [head, ...rest] = rows.filter((row) => !isAbsent(idCols, row))
  if (head === undefined) return null
  const firstKey = identityKey(idCols, head)
  const matching: NonEmpty<Row> = [
    head,
    ...rest.filter((row) => identityKey(idCols, row) === firstKey),
  ]
  return buildObject(schema, matching, path)
}

/**
 * Turn a schema into a reusable mapper from flat rows to nested domain objects.
 *
 * @example
 * const toUsers = mapRows({
 *   id: id<number>('user_id'),
 *   name: column<string>('user_name'),
 *   posts: hasMany({ id: id<number>('post_id'), title: column<string>('post_title') }),
 * })
 * const users = toUsers(rows)
 */
export function mapRows<S extends Schema>(
  schema: S,
): (rows: readonly Row[]) => OutputOf<S>[] {
  requireIdColumns(schema, 'root')
  return (rows) => nestCollection(schema, rows)
}

/**
 * Like {@link mapRows} but total: instead of throwing when a decoder rejects a
 * value or a discriminator has no matching case, it returns a `Result`. The
 * `Result` is a plain discriminated union with no library dependency — pattern
 * match on `.ok`, or adapt it to neverthrow/fp-ts/effect at the boundary.
 *
 * @example
 * const toUsers = safeMapRows(userSchema)
 * const result = toUsers(rows)
 * if (result.ok) use(result.value)
 * else report(result.error) // { message, cause }
 */
export function safeMapRows<S extends Schema>(
  schema: S,
): (rows: readonly Row[]) => Result<OutputOf<S>[], MappingError> {
  const run = mapRows(schema)
  return (rows) => {
    try {
      return ok(run(rows))
    } catch (thrown) {
      return err(toMappingError(thrown))
    }
  }
}
