import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import { column, flattenTree, id, tree, type Row } from '../../src'

const CATEGORY_DDL = `
CREATE TABLE categories (
  id        INTEGER PRIMARY KEY,
  parent_id INTEGER,
  name      TEXT NOT NULL
);
`

const config = {
  node: { id: id<number>('id'), name: column<string>('name') },
  id: 'id',
  parentId: 'parent_id',
  children: 'children',
} as const

const buildTree = tree(config)
const toRows = flattenTree(config)

// An arbitrary-depth category tree stored as an adjacency list.
const seed = [
  { id: 1, parent_id: null, name: 'All' },
  { id: 2, parent_id: 1, name: 'Books' },
  { id: 3, parent_id: 1, name: 'Electronics' },
  { id: 4, parent_id: 2, name: 'Fiction' },
  { id: 5, parent_id: 4, name: 'Sci-Fi' }, // depth 4
]

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  db.exec(CATEGORY_DDL)
})

function insertAll(rows: readonly Row[]): void {
  const stmt = db.prepare('INSERT INTO categories (id, parent_id, name) VALUES (@id, @parent_id, @name)')
  for (const row of rows) stmt.run(row)
}

const expectedForest = [
  {
    id: 1,
    name: 'All',
    children: [
      {
        id: 2,
        name: 'Books',
        children: [
          { id: 4, name: 'Fiction', children: [{ id: 5, name: 'Sci-Fi', children: [] }] },
        ],
      },
      { id: 3, name: 'Electronics', children: [] },
    ],
  },
]

describe('e2e: adjacency-list table <-> tree', () => {
  it('reads a flat adjacency list into a nested forest', () => {
    insertAll(seed)
    const rows: Row[] = db
      .prepare('SELECT id, parent_id, name FROM categories ORDER BY id')
      .all() as Row[]
    expect(buildTree(rows)).toEqual(expectedForest)
  })

  it('writes a forest back to adjacency-list rows that reload identically', () => {
    // domain forest -> rows -> INSERT -> SELECT -> forest
    insertAll(toRows(expectedForest))
    const rows: Row[] = db
      .prepare('SELECT id, parent_id, name FROM categories ORDER BY id')
      .all() as Row[]
    expect(buildTree(rows)).toEqual(expectedForest)
  })
})
