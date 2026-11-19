export type Song = { sONGBM?: string; sONGNAME: string; sINGER: string; cLOUD?: number | string; xH?: string; cats?: number[] }
export type Singer = { name: string; picture: string; qt_name?: string }

export type Filter = { songType?: string; lang?: string; sortType?: string; singer?: string }

// The server talks to the box; the browser only ever sees /api/*. a dead server can hang the connection, so cap the wait.
async function get<T>(url: string, params: Record<string, string | number> = {}): Promise<T> {
  const r = await fetch(`${url}?${new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v ?? '')]))}`, { signal: AbortSignal.timeout(6000) })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d.error ?? `${url}: HTTP ${r.status}`)
  return d
}

export const searchSongs = (q: string, f: Filter, page: number) => get<{ items: Song[]; maxPage: number }>('/api/songs', { q, ...f, page })
export const searchSingers = (q: string, type: number, page: number) => get<{ items: Singer[]; maxPage: number }>('/api/singers', { q, type, page })
export const getQueue = () => get<{ items: Song[]; count: number }>('/api/queue')
export const command = (cmd: string, value = '') => send('/api/queue/commands', 'POST', { cmd, value })
export const singerImg = (p: string) => `/api/singers/picture/${encodeURIComponent(p)}`

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
