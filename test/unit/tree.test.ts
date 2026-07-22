import { describe, expect, expectTypeOf, it } from 'vitest'
import { column, flattenTree, hasMany, id, isErr, safeTree, tree, type Row } from '../../src'

const config = {
  node: { id: id<number>('id'), name: column<string>('name') },
  id: 'id',
  parentId: 'parent_id',
  children: 'children',
} as const

const buildTree = tree(config)
const toRows = flattenTree(config)

describe('tree - adjacency list -> forest', () => {
  const rows: Row[] = [
    { id: 1, parent_id: null, name: 'root' },
    { id: 2, parent_id: 1, name: 'a' },
    { id: 3, parent_id: 1, name: 'b' },
    { id: 4, parent_id: 2, name: 'a1' }, // depth 3, unknown at schema time
  ]

  it('links nodes to arbitrary depth', () => {
    expect(buildTree(rows)).toEqual([
      {
        id: 1,
        name: 'root',
        children: [
          {
            id: 2,
            name: 'a',
            children: [{ id: 4, name: 'a1', children: [] }],
          },
          { id: 3, name: 'b', children: [] },
        ],
      },
    ])
  })

  it('treats a node with a missing/null parent as a root', () => {
    const forest = buildTree([
      { id: 1, parent_id: null, name: 'root' },
      { id: 9, parent_id: 999, name: 'orphan' }, // parent not in set -> root
    ])
    expect(forest.map((n) => n.id)).toEqual([1, 9])
  })

  it('round-trips through flattenTree', () => {
    const forest = buildTree(rows)
    expect(buildTree(toRows(forest))).toEqual(forest)
  })

  it('fails loudly on a parentId cycle instead of dropping data', () => {
    expect(() =>
      buildTree([
        { id: 2, parent_id: 3, name: 'x' },
        { id: 3, parent_id: 2, name: 'y' },
      ]),
    ).toThrow(/cycle/)
  })

  it('fails loudly on a self-parent node', () => {
    expect(() => buildTree([{ id: 1, parent_id: 1, name: 'loop' }])).toThrow(/cycle/)
  })

  it('safeTree returns Err on a cycle', () => {
    const result = safeTree(config)([
      { id: 2, parent_id: 3, name: 'x' },
      { id: 3, parent_id: 2, name: 'y' },
    ])
    expect(result.ok).toBe(false)
    if (isErr(result)) expect(result.error.message).toMatch(/cycle/)
  })

  it('flattenTree detects a hand-built cyclic forest', () => {
    const a: Record<string, unknown> = { id: 1, name: 'a', children: [] }
    const b: Record<string, unknown> = { id: 2, name: 'b', children: [a] }
    ;(a.children as unknown[]).push(b) // a <-> b cycle
    expect(() => toRows([a, b] as never)).toThrow(/cycle/)
  })

  it('infers a recursive node type', () => {
    const forest = buildTree(rows)
    expectTypeOf(forest[0]!.id).toEqualTypeOf<number>()
    expectTypeOf(forest[0]!.children).toEqualTypeOf<typeof forest>()
    // deep access compiles -> the type is genuinely recursive
    expectTypeOf(forest[0]!.children[0]!.children[0]!.name).toEqualTypeOf<string>()
  })
})

describe('tree - nodes built by mapRows-style grouping, then linked', () => {
  // Each node aggregates its own tags (a join), and nodes form a tree.
  const cfg = {
    node: {
      id: id<number>('id'),
      name: column<string>('name'),
      tags: hasMany({ id: id<number>('tag_id'), label: column<string>('tag') }),
    },
    id: 'id',
    parentId: 'parent_id',
    children: 'children',
  } as const

  const buildCategoryTree = tree(cfg)
  const toCategoryRows = flattenTree(cfg)

  // category x tag join rows, plus parent_id.
  const rows: Row[] = [
    { id: 1, parent_id: null, name: 'Root', tag_id: null, tag: null },
    { id: 2, parent_id: 1, name: 'Books', tag_id: 100, tag: 'new' },
    { id: 2, parent_id: 1, name: 'Books', tag_id: 101, tag: 'sale' },
    { id: 3, parent_id: 2, name: 'Fiction', tag_id: 102, tag: 'hot' },
  ]

  const expected = [
    {
      id: 1,
      name: 'Root',
      tags: [],
      children: [
        {
          id: 2,
          name: 'Books',
          tags: [
            { id: 100, label: 'new' },
            { id: 101, label: 'sale' },
          ],
          children: [
            { id: 3, name: 'Fiction', tags: [{ id: 102, label: 'hot' }], children: [] },
          ],
        },
      ],
    },
  ]

  it('aggregates each node from its join rows, then links the tree', () => {
    expect(buildCategoryTree(rows)).toEqual(expected)
  })

  it('round-trips composed nodes through flattenTree', () => {
    expect(buildCategoryTree(toCategoryRows(expected))).toEqual(expected)
  })
})
