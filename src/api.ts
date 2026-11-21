// Which browser this is, for the server's usage log. Made once and kept; getRandomValues works on plain http, where randomUUID doesn't.
const clientId = (() => {
  const make = () => [...crypto.getRandomValues(new Uint8Array(8))].map(b => b.toString(16).padStart(2, '0')).join('')
  try { return localStorage.getItem('ktv-client') ?? (localStorage.setItem('ktv-client', make()), localStorage.getItem('ktv-client')!) } catch { return make() } // storage blocked: an id per page load
})()
const apiFetch = (url: string, init: RequestInit = {}) => fetch(url, { ...init, headers: { ...init.headers, 'x-client': clientId } })

export type Song = { sONGBM?: string; sONGNAME: string; sINGER: string; cLOUD?: number | string; xH?: string; cats?: number[] }
export type Singer = { name: string; picture: string; qt_name?: string }

export type Filter = { songType?: string; lang?: string; sortType?: string; singer?: string }

// The server talks to the box; the browser only ever sees /api/*. a dead server can hang the connection, so cap the wait.
async function get<T>(url: string, params: Record<string, string | number> = {}): Promise<T> {
  const r = await apiFetch(`${url}?${new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v ?? '')]))}`, { signal: AbortSignal.timeout(6000) })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d.error ?? `${url}: HTTP ${r.status}`)
  return d
}

export const searchSongs = (q: string, f: Filter, page: number) => get<{ items: Song[]; maxPage: number }>('/api/songs', { q, ...f, page })
export const searchSingers = (q: string, type: number, page: number) => get<{ items: Singer[]; maxPage: number }>('/api/singers', { q, type, page })
export const getQueue = () => get<{ items: Song[]; count: number; current: Song | null; pending: Song[]; downloaded: string[] }>('/api/queue') // pending: cloud songs still downloading; current: the inferred playing song (null when idle)
// One entry point for every box action; queue edits go to /api/queue/songs, the rest are remote-control buttons under /api/player.
export type Origin = 'songs' | 'favorites' | 'history' // the tab a song request was made from
export const command = (action: string, value = '', info?: Song, origin?: Origin) => {
  const song = `/api/queue/songs/${encodeURIComponent(value)}`
  switch (action) {
    // The server can't see cloud songs while they download, so it needs to know which adds are cloud and what song they are.
    case 'add-song': return send('/api/queue/songs', 'POST', { id: value, cloud: !!Number(info?.cLOUD), song: info }, origin)
    case 'play-song-next': return send('/api/queue/songs', 'POST', { id: value, next: true, cloud: !!Number(info?.cLOUD), song: info }, origin)
    case 'move-next': return send(song, 'POST')
    case 'remove': return send(song, 'DELETE')
    default: return send(`/api/player/${action}`, 'POST')
  }
}
export const singerImg = (p: string) => `/api/singers/picture/${encodeURIComponent(p)}`

// Box address lives on the server (see server/ktv.ts), not in the browser, because the server is what talks to it.
export const getHost = () => apiFetch('/api/host').then(r => r.json()).then(d => d.host as string | null)
export async function setHost(host: string): Promise<string> {
  const r = await apiFetch('/api/host', { method: 'POST', body: JSON.stringify({ host }) })
  const d = await r.json()
  if (!r.ok) throw new Error(d.error)
  return d.host
}
export const getQr = () => apiFetch('/api/qr').then(r => r.json()).then(d => d.url as string)
export async function setQr(url: string): Promise<string> {
  const r = await apiFetch('/api/qr', { method: 'POST', body: JSON.stringify({ url }) })
  const d = await r.json()
  if (!r.ok) throw new Error(d.error)
  return d.url
}
// '' = this server; otherwise a full URL, checked from the browser since that's the network the redirect has to work on
export const serverId = (base = '') => fetch(base ? new URL('/api/id', base).href : '/api/id', { signal: AbortSignal.timeout(5000) }).then(r => r.json()).then(d => d.id as string)
export const scanNetwork =() => apiFetch('/api/scan').then(r => r.json()).then(d => d.found as string[])

// Favorites and history live in the front-end server's SQLite db (the box has neither). Cloud status is not stored: it goes stale.
export type ListName = 'favorites' | 'history'
const slim = ({ sONGBM, sONGNAME, sINGER }: Song) => ({ sONGBM, sONGNAME, sINGER })
// Throws the server's own error text when it sent one (e.g. a duplicate category name).
const send = async (url: string, method: string, body?: unknown, origin?: Origin) => {
  const r = await apiFetch(url, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: origin ? { 'x-origin': origin } : undefined })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d.error ?? `${method} ${url}: HTTP ${r.status}`)
  return d
}
export const getList = (name: ListName) => apiFetch(`/api/${name}`).then(r => r.json() as Promise<Song[]>)
// category (favorites only): a category id, or 'none' for Uncategorized
export const searchList = (name: ListName, q: string, category?: number | 'none') => apiFetch(`/api/${name}?${new URLSearchParams({ q, ...(category === undefined ? {} : { category: String(category) }) })}`).then(r => r.json() as Promise<Song[]>)
export const addFavorite = (s: Song) => send('/api/favorites', 'POST', slim(s))
export const removeFavorite = (bm: string) => send(`/api/favorites/${encodeURIComponent(bm)}`, 'DELETE')

export type Category = { id: number; name: string }
export type DeleteSongs = 'keep' | 'orphans' | 'all' // what happens to the songs in a deleted category
export const getCategories = () => apiFetch('/api/categories').then(r => r.json() as Promise<Category[]>)
export const addCategory = (name: string): Promise<Category> => send('/api/categories', 'POST', { name })
export const renameCategory = (id: number, name: string) => send(`/api/categories/${id}`, 'PATCH', { name })
export const reorderCategories = (ids: number[]) => send('/api/categories/order', 'PUT', { ids })
export const deleteCategory = (id: number, songs: DeleteSongs) => send(`/api/categories/${id}?songs=${songs}`, 'DELETE')
export const setSongCategory = (bm: string, id: number, on: boolean) => send(`/api/favorites/${encodeURIComponent(bm)}/categories/${id}`, on ? 'PUT' : 'DELETE')

export const clearList = (name: ListName) => send(`/api/${name}`, 'DELETE')
