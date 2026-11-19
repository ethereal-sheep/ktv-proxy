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
    CREATE TABLE IF NOT EXISTS favorites (sONGBM TEXT PRIMARY KEY, sONGNAME TEXT NOT NULL, sINGER TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS history (sONGBM TEXT PRIMARY KEY, sONGNAME TEXT NOT NULL, sINGER TEXT NOT NULL, seq INTEGER NOT NULL);`)
  return d
}
const get = () => (db ??= open()) // lazy: importing this from vite.config must not create the file

export const listSongs = (table: 'favorites' | 'history') =>
  get().prepare(`SELECT sONGBM, sONGNAME, sINGER FROM ${table} ORDER BY ${table === 'history' ? 'seq DESC' : 'rowid'}`).all()

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
