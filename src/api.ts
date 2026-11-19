const BASE = import.meta.env.VITE_API_BASE ?? '/demo/'

export type Song = { sONGBM?: string; sONGNAME: string; sINGER: string; cLOUD?: number | string; xH?: string; cats?: number[] }
export type Singer = { name: string; picture: string; qt_name?: string }

// The servlets only answer when given a JSONP callback name, so we ask for one and strip the wrapper.
async function call<T = Record<string, string>>(servlet: string, params: Record<string, string | number | boolean>): Promise<T> {
  const q = new URLSearchParams({ ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])), jsonpCallback: 'cb' })
  // a dead box can hang the connection rather than refuse it, so cap the wait
  const r = await fetch(`${BASE}${servlet}?${q}`, { signal: AbortSignal.timeout(6000) })
  if (!r.ok) throw new Error(`${servlet}: HTTP ${r.status}`)
  const m = (await r.text()).match(/^\s*cb\(([\s\S]*)\)\s*;?\s*$/)
  if (!m) throw new Error(`${servlet}: unexpected response`)
  return JSON.parse(m[1])
}

// List fields arrive as JSON strings inside the JSON.
const rows = <T,>(d: Record<string, string>, k: string): T[] => JSON.parse(d[k] || '[]')

export type Filter = { songType?: string; lang?: string; sortType?: string; singer?: string }

export async function searchSongs(songName: string, f: Filter, page: number) {
  // every param is required, or the server 500s
  const d = await call('SearchServlet', { songName, songType: '', singer: '', lang: '', sortType: '', ...f, page })
  return { items: rows<Song>(d, 'songList'), maxPage: +d.maxPage }
}

export async function searchSingers(singer: string, singerType: number, page: number) {
  const d = await call('SingerServlet', { singer, singerType, sortType: '', page })
  return { items: rows<Singer>(d, 'singerList'), maxPage: +d.maxPage }
}

export async function getQueue() {
  const d = await call('PlaylistServlet', { onSelectPage: true })
  return { items: rows<Song>(d, 'songList'), count: +d.number }
}

export const command = (cmd: string, cmdValue = '') => call('CommandServlet', { cmd, cmdValue })
export const singerImg = (p: string) => `${BASE}singer/${encodeURIComponent(p)}`

// Stub: the box exposes no now-playing/play-state servlet (see recon notes), so this is always null. Implement if one turns up.
export async function getNowPlaying(): Promise<Song | null> {
  return null
}

// Box address lives on the server (see server/ktv.ts), not in the browser, because the server is what talks to it.
export const getHost = () => fetch('/api/host').then(r => r.json()).then(d => d.host as string | null)
export async function setHost(host: string): Promise<string> {
  const r = await fetch('/api/host', { method: 'POST', body: JSON.stringify({ host }) })
  const d = await r.json()
  if (!r.ok) throw new Error(d.error)
  return d.host
}
export const scanNetwork = () => fetch('/api/scan').then(r => r.json()).then(d => d.found as string[])

// Favorites and history live in the front-end server's SQLite db (the box has neither). Cloud status is not stored: it goes stale.
export type ListName = 'favorites' | 'history'
const slim = ({ sONGBM, sONGNAME, sINGER }: Song) => ({ sONGBM, sONGNAME, sINGER })
// Throws the server's own error text when it sent one (e.g. a duplicate category name).
const send = async (url: string, method: string, body?: unknown) => {
  const r = await fetch(url, { method, body: body === undefined ? undefined : JSON.stringify(body) })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d.error ?? `${method} ${url}: HTTP ${r.status}`)
  return d
}
export const getList = (name: ListName) => fetch(`/api/${name}`).then(r => r.json() as Promise<Song[]>)
export const addFavorite = (s: Song) => send('/api/favorites', 'POST', slim(s))
export const removeFavorite = (bm: string) => send(`/api/favorites/${encodeURIComponent(bm)}`, 'DELETE')
export const recordHistory = (s: Song) => send('/api/history', 'POST', slim(s))

export type Category = { id: number; name: string }
export type DeleteSongs = 'keep' | 'orphans' | 'all' // what happens to the songs in a deleted category
export const getCategories = () => fetch('/api/categories').then(r => r.json() as Promise<Category[]>)
export const addCategory = (name: string): Promise<Category> => send('/api/categories', 'POST', { name })
export const renameCategory = (id: number, name: string) => send(`/api/categories/${id}`, 'PATCH', { name })
export const reorderCategories = (ids: number[]) => send('/api/categories/order', 'PUT', { ids })
export const deleteCategory = (id: number, songs: DeleteSongs) => send(`/api/categories/${id}?songs=${songs}`, 'DELETE')
export const setSongCategory = (bm: string, id: number, on: boolean) => send(`/api/favorites/${encodeURIComponent(bm)}/categories/${id}`, on ? 'PUT' : 'DELETE')
