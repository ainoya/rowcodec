import type { Row } from './spec'
import { ok, err, locate, toMappingError, type MappingError, type Result } from './result'

/**
 * The persistence side of rowcodec. Where the read schema (`mapRows`) knows only
 * the column *aliases* of a flat join, a persistence schema additionally knows
 * each level's TABLE, primary key, and the foreign-key column that links a child
 * to its parent. `decompose` uses that to turn nested domain aggregates into
 * NORMALIZED, per-table rows ready to INSERT — parents are not duplicated and
 * foreign keys are filled in automatically.
 *
 * This is the counterpart to `flattenRows`, which instead produces the
 * denormalized join rows used for reads/snapshots and must NOT be inserted.
 *
 * Out of scope (the repository's job): diffing for updates, UPSERT, and
 * transactions. `decompose` only produces the rows.
 */

/** A column mapped to a real DB column name, with an optional write encoder. */
export interface TableColumn<T> {
  readonly _kind: 'col'
  readonly column: string
  // Method syntax keeps `TableColumn<T>` assignable to `TableColumn<unknown>`.
  encode?(value: T): unknown
  readonly _t?: T
}

/** A value object whose columns live on the parent table's row. */
export interface EmbedTableSpec<F extends TableFields> {
  readonly _kind: 'embed'
  readonly fields: F
  readonly _t?: TFieldsOut<F>
}

/** A one-to-many child table linked by `fk` -> the parent's `pk`. */
/** A single column name, or several for a composite key. */
export type Keys = string | readonly string[]

export interface HasManyTableSpec<F extends TableFields> {
  readonly _kind: 'hasMany'
  readonly table: string
  readonly pk: Keys
  readonly fk: Keys
  readonly fields: F
  readonly _t?: TFieldsOut<F>[]
}

/** A nullable one-to-one child table linked by `fk` -> the parent's `pk`. */
export interface HasOneTableSpec<F extends TableFields> {
  readonly _kind: 'hasOne'
  readonly table: string
  readonly pk: Keys
  readonly fk: Keys
  readonly fields: F
  readonly _t?: TFieldsOut<F> | null
}

/** A root table definition. */
export interface TableSpec<F extends TableFields> {
  readonly _kind: 'table'
  readonly table: string
  readonly pk: Keys
  readonly fields: F
  readonly _t?: TFieldsOut<F>
}

export type TableField =
  | TableColumn<unknown>
  | EmbedTableSpec<TableFields>
  | HasManyTableSpec<TableFields>
  | HasOneTableSpec<TableFields>

export type TableFields = { readonly [key: string]: TableField }

export type TFieldOut<Sp> =
  Sp extends TableColumn<infer T>
    ? T
    : Sp extends EmbedTableSpec<infer F>
      ? TFieldsOut<F>
      : Sp extends HasManyTableSpec<infer F>
        ? TFieldsOut<F>[]
        : Sp extends HasOneTableSpec<infer F>
          ? TFieldsOut<F> | null
          : never

export type TFieldsOut<F extends TableFields> = { [K in keyof F]: TFieldOut<F[K]> }

/** The domain aggregate type a persistence schema maps. */
export type TInfer<S extends TableSpec<TableFields>> =
  S extends TableSpec<infer F> ? TFieldsOut<F> : never

// --- Builders --------------------------------------------------------------

/** A column mapped to a DB column name, with an optional write encoder. */
export function col<T = unknown>(
  column: string,
  encode?: (value: T) => unknown,
): TableColumn<T> {
  return encode ? { _kind: 'col', column, encode } : { _kind: 'col', column }
}

/** A value object embedded on the parent table's row (no separate table). */
export function embedTable<F extends TableFields>(fields: F): EmbedTableSpec<F> {
  return { _kind: 'embed', fields }
}

/** A one-to-many child table. `pk` is the child's own key; `fk` points to the parent. */
export function hasManyTable<F extends TableFields>(
  table: string,
  keys: { pk: Keys; fk: Keys },
  fields: F,
): HasManyTableSpec<F> {
  return { _kind: 'hasMany', table, pk: keys.pk, fk: keys.fk, fields }
}

/** A nullable one-to-one child table. `pk` is the child's own key; `fk` points to the parent. */
export function hasOneTable<F extends TableFields>(
  table: string,
  keys: { pk: Keys; fk: Keys },
  fields: F,
): HasOneTableSpec<F> {
  return { _kind: 'hasOne', table, pk: keys.pk, fk: keys.fk, fields }
}

/** A root table definition. */
export function table<F extends TableFields>(
  name: string,
  keys: { pk: Keys },
  fields: F,
): TableSpec<F> {
  return { _kind: 'table', table: name, pk: keys.pk, fields }
}

// --- Runtime ---------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function keyList(keys: Keys): readonly string[] {
  return typeof keys === 'string' ? [keys] : keys
}

/** The DB column names backing a level's primary-key field(s). */
function pkColumns(table: string, pk: Keys, fields: TableFields): string[] {
  return keyList(pk).map((name) => {
    const field = fields[name]
    if (field === undefined || field._kind !== 'col') {
      throw new Error(
        `rowcodec: decompose pk "${name}" on table "${table}" must be a col() field.`,
      )
    }
    return field.column
  })
}

/** Write a level's own columns (and embedded value objects) onto `row`. */
function writeColumns(
  fields: TableFields,
  obj: Record<string, unknown>,
  row: Row,
  path: string,
): void {
  for (const [key, field] of Object.entries(fields)) {
    const at = path ? `${path}.${key}` : key
    if (field._kind === 'col') {
      const value = obj[key]
      if (field.encode) {
        try {
          row[field.column] = field.encode(value)
        } catch (thrown) {
          throw locate(thrown, at)
        }
      } else {
        row[field.column] = value
      }
    } else if (field._kind === 'embed') {
      const value = obj[key]
      if (isObject(value)) writeColumns(field.fields, value, row, at)
    }
  }
}

interface Level {
  readonly table: string
  readonly pk: Keys
  readonly fields: TableFields
}

interface ForeignKey {
  readonly columns: readonly string[]
  readonly values: readonly unknown[]
}

function emit(
  level: Level,
  obj: Record<string, unknown>,
  foreignKey: ForeignKey | null,
  out: Record<string, Row[]>,
): void {
  const row: Row = {}
  if (foreignKey) {
    foreignKey.columns.forEach((column, i) => {
      row[column] = foreignKey.values[i]
    })
  }
  writeColumns(level.fields, obj, row, level.table)
  ;(out[level.table] ??= []).push(row)

  // Parent key values (already encoded on the row), to fill children's FK.
  const parentValues = pkColumns(level.table, level.pk, level.fields).map((c) => row[c])
  for (const [key, field] of Object.entries(level.fields)) {
    if (field._kind === 'hasMany') {
      const children = obj[key]
      if (Array.isArray(children)) {
        for (const child of children) {
          if (isObject(child)) {
            emit(field, child, { columns: keyList(field.fk), values: parentValues }, out)
          }
        }
      }
    } else if (field._kind === 'hasOne') {
      const child = obj[key]
      if (isObject(child)) {
        emit(field, child, { columns: keyList(field.fk), values: parentValues }, out)
      }
    }
  }
}

/**
 * Turn nested domain aggregates into normalized, INSERT-ready rows keyed by
 * table name. Parents appear once (no cartesian duplication) and child rows
 * carry their foreign key. Rows are emitted parent-before-child, so inserting
 * the tables in `Object.keys` order satisfies FK constraints.
 *
 * @example
 * const toTables = decompose(orderTable)
 * const { orders, order_lines, shipments } = toTables(orders)
 */
export function decompose<F extends TableFields>(
  root: TableSpec<F>,
): (items: readonly TFieldsOut<F>[]) => Record<string, Row[]> {
  return (items) => {
    const out: Record<string, Row[]> = {}
    for (const item of items) {
      if (isObject(item)) emit(root, item, null, out)
    }
    return out
  }
}

/**
 * Like {@link decompose} but total: returns a `Result` instead of throwing when
 * a column encoder rejects a value or the schema is misconfigured.
 */
export function safeDecompose<F extends TableFields>(
  root: TableSpec<F>,
): (items: readonly TFieldsOut<F>[]) => Result<Record<string, Row[]>, MappingError> {
  const run = decompose(root)
  return (items) => {
    try {
      return ok(run(items))
    } catch (thrown) {
      return err(toMappingError(thrown))
    }
  }
}
