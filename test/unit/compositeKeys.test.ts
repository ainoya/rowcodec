import { describe, expect, it } from 'vitest'
import { col, column, decompose, flattenTree, hasManyTable, id, table, tree, type Row } from '../../src'

describe('tree - composite keys (multi-tenant)', () => {
  const cfg = {
    node: {
      tenant: column<string>('tenant_id'),
      id: column<number>('id'),
      name: column<string>('name'),
    },
    id: ['tenant_id', 'id'],
    parentId: ['tenant_id', 'parent_id'],
    children: 'children',
  } as const

  const buildTree = tree(cfg)
  const toRows = flattenTree(cfg)

  // id=1 and id=5 exist in BOTH tenants; a single-column key would mis-merge them.
  const rows: Row[] = [
    { tenant_id: 'A', id: 1, parent_id: null, name: 'A-root' },
    { tenant_id: 'A', id: 5, parent_id: 1, name: 'A-child' },
    { tenant_id: 'B', id: 1, parent_id: null, name: 'B-root' },
    { tenant_id: 'B', id: 5, parent_id: 1, name: 'B-child' },
  ]

  const expected = [
    {
      tenant: 'A',
      id: 1,
      name: 'A-root',
      children: [{ tenant: 'A', id: 5, name: 'A-child', children: [] }],
    },
    {
      tenant: 'B',
      id: 1,
      name: 'B-root',
      children: [{ tenant: 'B', id: 5, name: 'B-child', children: [] }],
    },
  ]

  it('keys nodes by the (tenant, id) tuple, never mixing tenants', () => {
    expect(buildTree(rows)).toEqual(expected)
  })

  it('round-trips composite-key trees through flattenTree', () => {
    expect(buildTree(toRows(expected))).toEqual(expected)
  })
})

describe('decompose - composite foreign keys', () => {
  const orderTable = table('orders', { pk: ['tenantId', 'id'] }, {
    tenantId: col<string>('tenant_id'),
    id: col<number>('id'),
    lines: hasManyTable('order_lines', { pk: ['id'], fk: ['tenant_id', 'order_id'] }, {
      id: col<number>('id'),
      sku: col<string>('sku'),
    }),
  })

  it('fills every foreign-key column from the parent composite pk', () => {
    const result = decompose(orderTable)([
      { tenantId: 'A', id: 1, lines: [{ id: 10, sku: 'x' }, { id: 11, sku: 'y' }] },
    ])
    expect(result).toEqual({
      orders: [{ tenant_id: 'A', id: 1 }],
      order_lines: [
        { tenant_id: 'A', order_id: 1, id: 10, sku: 'x' },
        { tenant_id: 'A', order_id: 1, id: 11, sku: 'y' },
      ],
    })
  })
})

describe('back-compat - single-column keys still work', () => {
  it('tree with string id/parentId', () => {
    const build = tree({
      node: { id: id<number>('id'), name: column<string>('name') },
      id: 'id',
      parentId: 'parent_id',
      children: 'children',
    })
    expect(build([{ id: 1, parent_id: null, name: 'r' }])).toEqual([
      { id: 1, name: 'r', children: [] },
    ])
  })
})
