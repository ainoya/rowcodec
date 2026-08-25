# rowcodec

[![npm version](https://img.shields.io/npm/v/rowcodec?logo=npm)](https://www.npmjs.com/package/rowcodec)
[![npm downloads](https://img.shields.io/npm/dm/rowcodec)](https://www.npmjs.com/package/rowcodec)
[![bundle size](https://img.shields.io/bundlejs/size/rowcodec)](https://bundlejs.com/?q=rowcodec)
[![types](https://img.shields.io/npm/types/rowcodec)](https://arethetypeswrong.github.io/?p=rowcodec)
[![CI](https://github.com/ainoya/rowcodec/actions/workflows/ci.yml/badge.svg)](https://github.com/ainoya/rowcodec/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/rowcodec)](./LICENSE)

Map flat rows returned by any ORM/query builder — the denormalized product of
`LEFT JOIN`s — into **nested, aggregated domain objects**. ORM-agnostic,
functional (no classes), and fully type-inferred.

When you fetch an aggregate with joins in kysely, Drizzle, Prisma raw SQL, knex,
or plain `node-postgres`, you get one flat row per join combination:

```
{ user_id: 1, user_name: 'Alice', post_id: 10, post_title: 'Hello' }
{ user_id: 1, user_name: 'Alice', post_id: 11, post_title: 'World' }
{ user_id: 2, user_name: 'Bob',   post_id: null, post_title: null }   // left join miss
```

Hand-writing the grouping/decoding for that is fiddly and easy to get wrong.
`rowcodec` turns it into a declarative schema.

## Install

```sh
npm install rowcodec
# or: pnpm add rowcodec / yarn add rowcodec / bun add rowcodec
```

Zero runtime dependencies. Ships ESM and CJS builds with separate type
declarations for each, so `import` and `require` both resolve correctly under
`node16`/`nodenext` module resolution. Requires Node 18 or later; works in any
bundler and in the browser.

Every release is published from CI through [npm trusted
publishing](https://docs.npmjs.com/trusted-publishers/), so each version carries
a [provenance
attestation](https://docs.npmjs.com/generating-provenance-statements) linking it
to the exact commit and workflow run that built it.

## Usage

```ts
import { mapRows, id, column, hasMany, type Infer } from 'rowcodec'

const schema = {
  id: id<number>('user_id'),
  name: column<string>('user_name'),
  posts: hasMany({
    id: id<number>('post_id'),
    title: column<string>('post_title'),
  }),
}

type User = Infer<typeof schema>
// { id: number; name: string; posts: { id: number; title: string }[] }

const toUsers = mapRows(schema)

const users = toUsers([
  { user_id: 1, user_name: 'Alice', post_id: 10, post_title: 'Hello' },
  { user_id: 1, user_name: 'Alice', post_id: 11, post_title: 'World' },
  { user_id: 2, user_name: 'Bob', post_id: null, post_title: null },
])
```

```jsonc
[
  { "id": 1, "name": "Alice",
    "posts": [ { "id": 10, "title": "Hello" }, { "id": 11, "title": "World" } ] },
  { "id": 2, "name": "Bob", "posts": [] }   // left-join miss -> empty array
]
```

`toUsers` is a plain function `(rows) => User[]`. Pass it whatever your driver
returns — rowcodec only reads plain objects.

## Concepts

| Builder            | Produces            | Notes                                                        |
| ------------------ | ------------------- | ----------------------------------------------------------- |
| `id<T>(name, dec?)`   | `T`              | Identity column: forms the grouping key for its level.      |
| `column<T>(name, dec?)` | `T`            | A plain column.                                             |
| `compute<T>(fn)`   | `T`                 | Derive a field from the whole row.                          |
| `hasMany(schema)`  | `Output[]`          | One-to-many. Left-join misses become an empty array.        |
| `hasOne(schema)`   | `Output \| null`    | One-to-one relation. Requires `id()`; left-join miss → `null`. |
| `embed(schema)`    | `Output`            | Required, id-less value object from current-row columns; never null. |
| `optionalEmbed(schema)` | `Output \| null` | Like `embed`, but `null` when all its columns are null.        |
| `variant(col, as, cases)` | discriminated union | A column selects the case; see below.                |
| `optionalVariant(col, as, cases)` | `Union \| null` | Like `variant`, but `null` when the discriminator is null. |
| `mapRows(schema)`  | `(rows) => Output[]`| Compile a root schema into a mapper (rows → objects).       |
| `flattenRows(schema)` | `(items) => Row[]` | The reverse mapper (objects → rows). See below.           |

Relations nest to **any depth** in both directions — `users → posts → comments`
is just nested `hasMany`/`hasOne`, and everything below composes recursively.

### Identity columns drive everything

Each nested level must declare at least one `id()` column. rowcodec uses them to:

1. **Group** rows into aggregates (rows sharing the same identity collapse into one object).
2. **Detect outer-join misses** — when every `id()` column of a nested level is
   `null`/`undefined`, that relation is treated as "no matching row"
   (skipped for `hasMany`, `null` for `hasOne`).

Composite keys are supported — declare multiple `id()` columns:

```ts
const schema = {
  orgId: id<number>('org_id'),
  userId: id<number>('user_id'),
  // ...
}
```

### Cartesian products are un-inflated

Two `hasMany` relations at the same level produce a cartesian product of rows
in SQL. rowcodec groups each collection by its own identity, so you get the right
counts back — not the multiplied ones.

### Decoders and computed fields

```ts
const toEvents = mapRows({
  id: id<string>('event_id', (v) => String(v)),
  at: column('created_at', (v) => new Date(v as string)),
  active: column('is_active', (v) => v === 1),
  label: compute<string>((row) => `${row.kind}:${row.event_id}`),
})
```

`column<T>('col')` without a decoder passes the raw value through and trusts
your `T` annotation. Provide a decoder when you need real parsing/validation
(e.g. `zod`: `column('meta', (v) => MetaSchema.parse(v))`).

## Deep nesting

Relations nest arbitrarily deep — `users → posts → comments` is just nested
`hasMany`. Ordering is preserved (first-seen order of rows).

## Value objects (`embed`)

A multi-column **value object** — `Money`, `Address`, `DateRange` — is required,
has no identity of its own, and lives on the same row as its parent. Use
`embed`: it needs no `id()`, is never `null`, and (unlike `compute`) round-trips
through `flattenRows`.

```ts
interface Money { amountCents: number; currency: string }

const schema = {
  id: id<number>('order_id'),
  total: embed({
    amountCents: column<number>('total_amount'),
    currency: column<string>('total_currency'),
  }),
}

type Order = Infer<typeof schema>
// { id: number; total: { amountCents: number; currency: string } }   // total is never null
```

Embeds compose — put one inside a `hasMany` for per-line money, or nest embeds
for `Address`-in-`Contact`.

For an **optional** value object (e.g. an optional shipping address stored as
nullable columns), use `optionalEmbed`: it decodes to `null` when every one of
its columns is null, so the type is honestly `T | null` — no object full of
nulls masquerading as a value.

```ts
shippingAddress: optionalEmbed({
  line1: column<string>('ship_line1'),
  postcode: column<string>('ship_postcode'),
})
// -> { line1: string; postcode: string } | null
```

Reach for `hasOne` instead only when the relation lives in another table and has
its own identity.

## Discriminated unions (`variant`)

When a nested value is a tagged union — a `payment` that is either a card or a
bank transfer, etc. — use `variant(discriminatorColumn, tagField, cases)`. A
column's value selects which case schema to build, and the chosen tag is emitted
as a literal on `tagField`, producing a real discriminated union type. Cases can
themselves contain columns, `hasMany`/`hasOne`, and further `variant`s.

```ts
const schema = {
  id: id<number>('order_id'),
  payment: variant('payment_kind', 'kind', {
    card: { last4: column<string>('card_last4') },
    bank: { iban: column<string>('bank_iban') },
  }),
}

type Order = Infer<typeof schema>
// {
//   id: number
//   payment: { kind: 'card'; last4: string } | { kind: 'bank'; iban: string }
// }
```

- Binds cleanly to a `z.discriminatedUnion(...)` (or any external union) through
  `schemaFor<Order>()` — the tags and shapes are checked to match.
- `flattenRows` reverses it: it writes the discriminator column and nulls the
  columns of the inactive cases, mirroring a join.
- An unknown discriminator value throws a descriptive error. For a
  **left-joined, possibly-absent** union, use `optionalVariant` — it decodes to
  `null` when the discriminator column is null, giving `Union | null`.
- The literal tag always wins, so if a case column happens to share the `as`
  name the runtime value still matches the declared discriminated-union type.

## Reverse: objects → rows (`flattenRows`)

`flattenRows` is the inverse of `mapRows`, built from the **same schema**. It
expands nested domain objects back into the flat, denormalized rows a join
would produce — useful for snapshots, fixtures, bulk export, or feeding another
system.

```ts
const schema = {
  id: id<number>('user_id'),
  name: column<string>('user_name'),
  posts: hasMany({ id: id<number>('post_id'), title: column<string>('post_title') }),
}

const toRows = flattenRows(schema)

toRows([{ id: 1, name: 'Alice', posts: [{ id: 10, title: 'A' }, { id: 11, title: 'B' }] }])
// [
//   { user_id: 1, user_name: 'Alice', post_id: 10, post_title: 'A' },
//   { user_id: 1, user_name: 'Alice', post_id: 11, post_title: 'B' },
// ]
```

- Sibling collections multiply out (cartesian product); empty collections and
  `null` `hasOne`s emit a fully-nulled sub-row, mirroring a left-join miss.
- It nests to any depth, exactly like the forward direction.
- Round-trips: `mapRows(schema)(flattenRows(schema)(items))` reproduces `items`.

> **`flattenRows` is not for saving.** It produces the *denormalized* join rows
> a read returns — parent columns are duplicated across child rows and all
> tables are mixed into one row, so these cannot be `INSERT`ed into normalized
> tables. Use it for snapshots, exports, caches, and round-trip tests. To
> persist an aggregate, use [`decompose`](#persisting-aggregates-decompose).

## Persisting aggregates (`decompose`)

Saving needs the opposite of a read: *normalized*, per-table rows with foreign
keys — not one denormalized row. That requires structure the read schema does
not carry (table names, primary keys, foreign keys), so `decompose` uses a
dedicated **persistence schema** built with `table` / `hasManyTable` /
`hasOneTable` / `embedTable` / `col`.

```ts
import { decompose, table, col, hasManyTable, hasOneTable, embedTable } from 'rowcodec'

const orderTable = table('orders', { pk: 'id' }, {
  id: col<number>('id'),
  customerName: col<string>('customer_name'),
  total: embedTable({ amountCents: col<number>('total_amount'), currency: col<string>('total_currency') }),
  lines: hasManyTable('order_lines', { pk: 'id', fk: 'order_id' }, {
    id: col<number>('id'),
    sku: col<string>('sku'),
  }),
  shipment: hasOneTable('shipments', { pk: 'id', fk: 'order_id' }, {
    id: col<number>('id'),
    carrier: col<string>('carrier'),
  }),
})

const { orders, order_lines, shipments } = decompose(orderTable)(aggregates)
// orders:      one row per aggregate (never duplicated), embed columns merged
// order_lines: child rows with order_id filled in
// shipments:   present only when the relation is non-null
```

- Foreign keys are filled from the parent's `pk` automatically.
- Empty collections and `null` relations emit no rows.
- Rows come out parent-before-child, so inserting the tables in key order
  satisfies FK constraints.
- **Composite keys**: `pk` and `fk` accept arrays — `{ pk: ['tenant_id', 'id'] }`,
  `{ pk: ['id'], fk: ['tenant_id', 'order_id'] }`. Each foreign-key column is
  filled from the matching parent primary-key column (same order).
- **Out of scope** (the repository's job): diffing existing rows for updates,
  `UPSERT`, and transactions. `decompose` only produces the rows to write.

For lossless codecs, give the column both directions:

```ts
column('created_at', {
  decode: (v) => new Date(v as string),
  encode: (d: Date) => d.toISOString(),
})
```

Columns without an `encode` pass the value through; `compute()` fields are
decode-only and are skipped when flattening.

## Type-first: binding to a domain type (`schemaFor`)

`type User = Infer<typeof schema>` makes the schema the source of truth. But
most codebases already define the domain model elsewhere — often with **zod**
or **ajv**. `schemaFor<T>()` flips the direction: the domain type stays the
source of truth and the schema is *checked against it*. If the schema's output
drifts from `T` (missing field, wrong type, `null` vs `undefined`, extra field),
the schema fails to type-check.

```ts
import { z } from 'zod'
import { schemaFor, mapRows, flattenRows, id, column, hasMany } from 'rowcodec'

const UserId = z.number().brand<'UserId'>()          // branded ids are supported
const User = z.object({
  id: UserId,
  name: z.string(),
  posts: z.array(z.object({ id: z.number(), title: z.string() })),
})
type User = z.infer<typeof User>

const userSchema = schemaFor<User>()({
  id: id<z.infer<typeof UserId>>('user_id'),
  name: column<string>('user_name'),
  posts: hasMany({ id: id<number>('post_id'), title: column<string>('post_title') }),
})   // ← compile error if this no longer matches `User`

const toUsers = mapRows(userSchema)
const toRows = flattenRows(userSchema)
```

**This adds no dependency to rowcodec** — `schemaFor` is purely type-level.
zod/ajv live in *your* code:

- **Type-level:** feed the inferred type (`z.infer<...>`, or ajv's
  `JSONSchemaType<T>` target) into `schemaFor<T>()`.
- **Runtime validation:** because a decoder is just `(value: unknown) => T`, plug
  a validator straight in — `column('meta', (v) => Meta.parse(v))` (zod) — or
  validate the finished aggregate (`User.parse(user)` / ajv's `validate(user)`).
- **Branded ids** (`number & { __brand }`, `z.number().brand()`): pass the brand
  as the column's type argument; the brand is compile-time only, so no runtime
  cost.

See `test/e2e/zod.test.ts` and `test/e2e/ajv.test.ts` for full working examples.

## `null` vs `undefined` (persistence model, not domain model)

rowcodec's output is a **persistence model**: absence is represented as `null`,
because that is what an RDBMS returns. `hasOne`/`optionalEmbed` decode to
`T | null`, and a nullable column stays `null`. rowcodec never emits `undefined`
and never omits a key.

TypeScript codebases often prefer `undefined` / optional properties (`field?: T`)
in the **domain model**. That is a different layer. Following the standard
DTO → domain split, do the `null → undefined` conversion in the step that turns
rowcodec's output into your domain object — not inside rowcodec:

```ts
// 1. rowcodec -> persistence/DTO shape (null-based). Bind schemaFor to THIS type.
interface CustomerRow { id: number; shippingAddress: Address | null }
const toRows = mapRows(schemaFor<CustomerRow>()({ /* ... */ }))

// 2. DTO -> domain (undefined-based). This is your factory's job.
interface Customer { id: number; shippingAddress?: Address }
const toDomain = (r: CustomerRow): Customer =>
  r.shippingAddress === null
    ? { id: r.id }                                  // omit -> matches `?:`
    : { id: r.id, shippingAddress: r.shippingAddress }
```

This keeps rowcodec honest about what the database actually returned, and keeps
`null`/`undefined` policy where it belongs — in your domain layer. (If you only
need it for a scalar column, a codec does it inline:
`column('mid', { decode: v => v ?? undefined, encode: v => v ?? null })`.)

## Recursive trees (`tree`)

Self-referential aggregates of unknown depth — category trees, comment threads,
org charts — are stored as an **adjacency list** (each row has its own id and a
`parentId`), not as a join. That is a different shape from `mapRows`, so it has
its own builder: `tree`. The recursion is in the *data*, not the schema — you
describe a single finite node and `tree` links parents to children to any depth.

```ts
const buildTree = tree({
  node: { id: id<number>('id'), name: column<string>('name') },
  id: 'id',
  parentId: 'parent_id',
  children: 'children',
})

const forest = buildTree(rows)
// Category[] where Category = { id; name; children: Category[] }  — recursive type
```

- Feed it the flat result of `SELECT * FROM categories` (or a `WITH RECURSIVE` CTE).
- A node whose parent is `null`/absent becomes a root; sibling order is preserved.
- `flattenTree(config)` is the reverse — a forest back to adjacency-list rows,
  filling `parentId` from the structure — so it round-trips.
- A `parentId` cycle (or self-parent) would leave nodes reachable from no root.
  Rather than silently dropping them, `tree` throws; `safeTree(config)` returns a
  `Result`. `flattenTree` likewise detects cycles instead of looping forever.
- **Composite keys** (e.g. multi-tenant `(tenant_id, id)`): pass arrays for `id`
  and `parentId` — `id: ['tenant_id', 'id']`, `parentId: ['tenant_id', 'parent_id']`
  (same order). Nodes are keyed by the tuple, so ids never collide across tenants.

The `node` is a full read schema, so a node can be an aggregate in its own right
— rows are grouped by node id (like `mapRows`) before being tree-linked:

```ts
const buildTree = tree({
  node: {
    id: id<number>('id'),
    name: column<string>('name'),
    tags: hasMany({ id: id<number>('tag_id'), label: column<string>('tag') }),
  },
  id: 'id',
  parentId: 'parent_id',
  children: 'children',
})
// each node aggregates its tags from the join, then the nodes form the tree
```

## Total mapping (`safeMapRows`)

By default `mapRows` throws when a decoder rejects a value or a discriminator has
no matching case. `safeMapRows` is the total version: it returns a `Result`
instead of throwing.

```ts
const toUsers = safeMapRows(userSchema)

const result = toUsers(rows)
if (result.ok) {
  save(result.value)          // T[]
} else {
  log(result.error.path)      // e.g. "[0].posts[1].title" — where it failed
  log(result.error.message)   // the underlying decoder/validator message
}
```

The `Result` is a **plain discriminated union — no library dependency**:

```ts
type Result<T, E = MappingError> =
  | { ok: true; value: T }
  | { ok: false; error: E }

interface MappingError { message: string; path: string; cause?: unknown }
```

`decompose` has the same treatment: `safeDecompose(table)` returns a `Result`
instead of throwing when a column encoder rejects a value.

Because it carries no methods, it never locks you in. Convert to your library
of choice at the boundary with a one-liner:

```ts
import { ok as okNT, err as errNT } from 'neverthrow'
const nt = result.ok ? okNT(result.value) : errNT(result.error)

import { right, left } from 'fp-ts/Either'
const either = result.ok ? right(result.value) : left(result.error)
```

## Aggregates (counts, sums): do them in SQL

rowcodec deliberately has no in-memory "fold over the group" combinator, because
you rarely want one. Aggregate on the query side:

- **Only the aggregate, not the children** — `GROUP BY` in SQL and map the result
  column: `lineCount: column('line_count')`.
- **Children *and* an aggregate together** — use a **window function**; the
  per-group value repeats on every join row, so `column()` (which reads it off
  the group) picks it up while `hasMany` still nests the rows:

  ```sql
  SELECT o.id, l.id AS line_id, l.price,
         COUNT(*)     OVER (PARTITION BY o.id) AS line_count,
         SUM(l.price) OVER (PARTITION BY o.id) AS total_cents
  FROM orders o LEFT JOIN order_lines l ON l.order_id = o.id
  ```

- **Derive it afterwards** — nest with `hasMany` and compute in your own code:
  `order.lines.length`, `order.lines.reduce(...)`.

(`compute` intentionally sees one row — it's for combining columns of a single
row, e.g. `first + last`, not for folding a group.)

## Design notes

- No classes; everything is plain functions and data.
- Output types are inferred from the schema — no duplicate manual interfaces.
- ORM-agnostic: works on any `Record<string, unknown>[]`.
- Zero runtime dependencies.

## Testing

```sh
pnpm test        # vitest run
pnpm typecheck   # tsc --noEmit (also checks the type-level tests)
```

- `test/unit` — table-driven unit tests covering grouping, outer-join misses,
  deduplication/ordering, `hasOne`, deep nesting, cartesian products, decoders,
  `compute`, composite keys, root edge cases, validation, and type inference.
- `test/e2e` — end-to-end tests that stand up a real SQLite database and
  reconstruct the domain aggregate from actual `LEFT JOIN` output of both
  **kysely** and **drizzle**, integration with **zod** and **ajv** domain
  models (branded ids, discriminated unions, runtime validation), plus pure
  domain ⇄ row round-trips.

## License

MIT
