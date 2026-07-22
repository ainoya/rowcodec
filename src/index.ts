export {
  id,
  column,
  compute,
  hasMany,
  hasOne,
  embed,
  optionalEmbed,
  variant,
  optionalVariant,
} from './spec'

export type {
  Row,
  Schema,
  Codec,
  ColumnSpec,
  ComputeSpec,
  CollectionSpec,
  SingleSpec,
  EmbedSpec,
  OptionalEmbedSpec,
  VariantSpec,
  OptionalVariantSpec,
  VariantCases,
  VariantOutput,
  AnySpec,
  SpecOutput,
  OutputOf,
  Infer,
} from './spec'

export { mapRows, safeMapRows, nestCollection, nestSingle } from './nest'
export { flattenRows } from './flatten'
export { schemaFor } from './typed'
export { tree, safeTree, flattenTree } from './tree'
export type { TreeNode, TreeConfig } from './tree'

export { ok, err, isOk, isErr, RowcodecError } from './result'
export type { Result, Ok, Err, MappingError } from './result'

export {
  decompose,
  safeDecompose,
  table,
  col,
  embedTable,
  hasManyTable,
  hasOneTable,
} from './decompose'

export type {
  TableSpec,
  TableColumn,
  TableField,
  TableFields,
  EmbedTableSpec,
  HasManyTableSpec,
  HasOneTableSpec,
  TFieldOut,
  TFieldsOut,
  TInfer,
} from './decompose'
