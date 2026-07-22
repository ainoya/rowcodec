import type { OutputOf, Row, Schema } from './spec'

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Every column name reachable in a schema tree (own columns + all descendants). */
function allColumnNames(schema: Schema): string[] {
  const names: string[] = []
  for (const spec of Object.values(schema)) {
    if (spec._tag === 'column') names.push(spec.name)
    else if (
      spec._tag === 'collection' ||
      spec._tag === 'single' ||
      spec._tag === 'embed' ||
      spec._tag === 'optionalEmbed'
    ) {
      names.push(...allColumnNames(spec.schema))
    } else if (spec._tag === 'variant' || spec._tag === 'optionalVariant') {
      names.push(spec.discriminator)
      for (const caseSchema of Object.values(spec.cases)) {
        names.push(...allColumnNames(caseSchema))
      }
    }
  }
  return names
}

/** A row where this level and every descendant column is `null` (outer-join miss). */
function nullRow(schema: Schema): Row {
  const row: Row = {}
  for (const name of allColumnNames(schema)) row[name] = null
  return row
}

/** Encode just this level's own columns from a domain object. */
function ownColumns(schema: Schema, obj: Record<string, unknown>): Row {
  const row: Row = {}
  for (const [key, spec] of Object.entries(schema)) {
    if (spec._tag !== 'column') continue
    const value = obj[key]
    row[spec.name] = spec.encode ? spec.encode(value) : value
  }
  return row
}

function cartesian(left: readonly Row[], right: readonly Row[]): Row[] {
  const out: Row[] = []
  for (const l of left) {
    for (const r of right) out.push({ ...l, ...r })
  }
  return out
}

/**
 * Expand one domain object into the flat rows a join would have produced.
 * Nested collections multiply out (cartesian product); a missing relation
 * contributes a fully-nulled sub-row. Recurses to any depth.
 */
function encodeObject(schema: Schema, obj: Record<string, unknown>): Row[] {
  let rows: Row[] = [ownColumns(schema, obj)]
  for (const [key, spec] of Object.entries(schema)) {
    if (spec._tag === 'collection') {
      const value = obj[key]
      const childRows: Row[] = []
      if (Array.isArray(value)) {
        for (const child of value) {
          if (isObject(child)) childRows.push(...encodeObject(spec.schema, child))
        }
      }
      rows = cartesian(rows, childRows.length > 0 ? childRows : [nullRow(spec.schema)])
    } else if (
      spec._tag === 'single' ||
      spec._tag === 'embed' ||
      spec._tag === 'optionalEmbed'
    ) {
      const value = obj[key]
      const childRows = isObject(value)
        ? encodeObject(spec.schema, value)
        : [nullRow(spec.schema)]
      rows = cartesian(rows, childRows)
    } else if (spec._tag === 'variant' || spec._tag === 'optionalVariant') {
      const value = obj[key]
      // Null out every case's columns (+ the discriminator), then overlay the
      // active case, mirroring how a join leaves inactive columns null. An
      // absent optionalVariant (null) stays fully nulled.
      const base: Row = {}
      for (const name of allColumnNames({ v: spec })) base[name] = null
      if (isObject(value)) {
        const tag = value[spec.as]
        const caseSchema = spec.cases[String(tag)]
        const activeRows = caseSchema ? encodeObject(caseSchema, value) : [{}]
        rows = cartesian(
          rows,
          activeRows.map((r) => ({ ...base, ...r, [spec.discriminator]: tag })),
        )
      } else {
        rows = cartesian(rows, [base])
      }
    }
  }
  return rows
}

/**
 * The reverse of {@link mapRows}: turn nested domain objects back into the flat,
 * denormalized rows a join would produce. Uses each column's `encode` (falling
 * back to pass-through) and nulls every column of missing relations, so
 * `mapRows(schema)(flattenRows(schema)(items))` reproduces `items`.
 *
 * Note: `compute()` fields are decode-only and are skipped when flattening.
 *
 * @example
 * const toRows = flattenRows(userSchema)
 * const rows = toRows(users)
 */
export function flattenRows<S extends Schema>(
  schema: S,
): (items: readonly OutputOf<S>[]) => Row[] {
  return (items) => {
    const rows: Row[] = []
    for (const item of items) {
      if (isObject(item)) rows.push(...encodeObject(schema, item))
    }
    return rows
  }
}

/**
 * Encode one node object into its rows (used by `flattenTree`). A node with its
 * own nested collections expands to several join rows.
 */
export function encodeNode(schema: Schema, obj: Record<string, unknown>): Row[] {
  return encodeObject(schema, obj)
}

/** All column names a schema writes (used by `flattenTree` to protect own columns). */
export function schemaColumns(schema: Schema): string[] {
  return allColumnNames(schema)
}
