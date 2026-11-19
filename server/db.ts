// Favorites and history in SQLite (node:sqlite, built into Node 24, so no dependency). The file sits beside the config, so it shares its volume.
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

// Cloud status is deliberately not stored: it goes stale and is costly to re-check. Rows show whatever the search result says.
export type Song = { sONGBM: string; sONGNAME: string; sINGER: string }
const HISTORY_MAX = 100

export const isSong = (s: any): s is Song =>
  ['sONGBM', 'sONGNAME', 'sINGER'].every(k => typeof s?.[k] === 'string' && s[k].length <= 500) && s.sONGBM !== ''

let dir = '.'
export const setDbDir = (d: string) => { dir = d } // call before first use

let db: DatabaseSync | undefined
const open = () => {
  mkdirSync(dir, { recursive: true })
  const d = new DatabaseSync(join(dir, 'ktv.db'))
  d.exec(`
    PRAGMA foreign_keys = ON; -- deleting a favorite or category cascades to the links
    CREATE TABLE IF NOT EXISTS favorites (sONGBM TEXT PRIMARY KEY, sONGNAME TEXT NOT NULL, sINGER TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS history (sONGBM TEXT PRIMARY KEY, sONGNAME TEXT NOT NULL, sINGER TEXT NOT NULL, seq INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS categories (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE);
    CREATE TABLE IF NOT EXISTS favorite_categories (
      sONGBM TEXT NOT NULL REFERENCES favorites(sONGBM) ON DELETE CASCADE,
      category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      PRIMARY KEY (sONGBM, category_id));`)
  // pos orders the categories (drag to reorder); older dbs get it added, seeded from id so the order doesn't change
  if (!(d.prepare('PRAGMA table_info(categories)').all() as { name: string }[]).some(c => c.name === 'pos'))
    d.exec('ALTER TABLE categories ADD COLUMN pos INTEGER NOT NULL DEFAULT 0; UPDATE categories SET pos = id')
  return d
}
const get = () => (db ??= open()) // lazy: importing this from vite.config must not create the file

export const listHistory = () => get().prepare('SELECT sONGBM, sONGNAME, sINGER FROM history ORDER BY seq DESC').all()

export function listFavorites() {
  const d = get()
  const cats = new Map<string, number[]>()
  for (const l of d.prepare('SELECT sONGBM, category_id FROM favorite_categories ORDER BY category_id').all() as { sONGBM: string; category_id: number }[])
    cats.set(l.sONGBM, [...(cats.get(l.sONGBM) ?? []), l.category_id])
  return (d.prepare('SELECT sONGBM, sONGNAME, sINGER FROM favorites ORDER BY rowid').all() as Song[]).map(s => ({ ...s, cats: cats.get(s.sONGBM) ?? [] }))
}

export const addFavorite = (s: Song) =>
  get().prepare('INSERT INTO favorites VALUES (?, ?, ?) ON CONFLICT(sONGBM) DO NOTHING').run(s.sONGBM, s.sONGNAME, s.sINGER)

export const removeFavorite = (bm: string) => get().prepare('DELETE FROM favorites WHERE sONGBM = ?').run(bm)

// seq is a counter, not a clock, so entries recorded in the same millisecond still sort correctly.
export function recordHistory(s: Song) {
  const d = get()
  d.prepare(`INSERT INTO history VALUES (?, ?, ?, (SELECT COALESCE(MAX(seq), 0) + 1 FROM history))
    ON CONFLICT(sONGBM) DO UPDATE SET sONGNAME = excluded.sONGNAME, sINGER = excluded.sINGER, seq = excluded.seq`).run(s.sONGBM, s.sONGNAME, s.sINGER)
  d.prepare('DELETE FROM history WHERE sONGBM NOT IN (SELECT sONGBM FROM history ORDER BY seq DESC LIMIT ?)').run(HISTORY_MAX)
}

// Categories. Names are unique ignoring case (a duplicate throws a UNIQUE error, which the route maps to 409).
export const cleanName = (n: unknown) => (typeof n === 'string' && n.trim().length >= 1 && n.trim().length <= 50 ? n.trim() : null)
export const listCategories = () => get().prepare('SELECT id, name FROM categories ORDER BY pos, id').all()
export const addCategory = (name: string) => get().prepare('INSERT INTO categories (name, pos) VALUES (?, (SELECT COALESCE(MAX(pos), 0) + 1 FROM categories)) RETURNING id, name').get(name)
export const renameCategory = (id: number, name: string) => get().prepare('UPDATE categories SET name = ? WHERE id = ? RETURNING id, name').get(name, id)

// ids in the new order; categories the list doesn't mention (added by another device meanwhile) keep their place after it
export function reorderCategories(ids: number[]) {
  const d = get()
  d.exec('BEGIN')
  try {
    const up = d.prepare('UPDATE categories SET pos = ? WHERE id = ?')
    ids.forEach((id, i) => up.run(i + 1, id))
    d.prepare('UPDATE categories SET pos = pos + ? WHERE id NOT IN (' + ids.map(() => '?').join() + ')').run(ids.length, ...ids)
    d.exec('COMMIT')
  } catch (e) { d.exec('ROLLBACK'); throw e }
}

// songs: what happens to the songs in the category. keep = they stay favorited; orphans = also un-favorite those in no other
// category; all = un-favorite every song in it. Links go with the category/favorite via ON DELETE CASCADE.
export function deleteCategory(id: number, songs: 'keep' | 'orphans' | 'all') {
  const d = get()
  d.exec('BEGIN')
  try {
    const inCat = 'SELECT sONGBM FROM favorite_categories WHERE category_id = ?'
    if (songs === 'all') d.prepare(`DELETE FROM favorites WHERE sONGBM IN (${inCat})`).run(id)
    if (songs === 'orphans') d.prepare(`DELETE FROM favorites WHERE sONGBM IN (${inCat}) AND (SELECT COUNT(*) FROM favorite_categories x WHERE x.sONGBM = favorites.sONGBM) = 1`).run(id)
    d.prepare('DELETE FROM categories WHERE id = ?').run(id)
    d.exec('COMMIT')
  } catch (e) { d.exec('ROLLBACK'); throw e }
}

// Throws (FOREIGN KEY) if the song isn't a favorite or the category doesn't exist.
export function setSongCategory(bm: string, id: number, on: boolean) {
  get().prepare(on ? 'INSERT OR IGNORE INTO favorite_categories VALUES (?, ?)' : 'DELETE FROM favorite_categories WHERE sONGBM = ? AND category_id = ?').run(bm, id)
}
