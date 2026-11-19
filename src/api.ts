const BASE = import.meta.env.VITE_API_BASE ?? '/demo/'

export type Song = { sONGBM?: string; sONGNAME: string; sINGER: string; cLOUD?: number | string; xH?: string }
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
const send = (url: string, method: string, body?: unknown) =>
  fetch(url, { method, body: body === undefined ? undefined : JSON.stringify(body) }).then(r => { if (!r.ok) throw new Error(`${method} ${url}: HTTP ${r.status}`) })
export const getList = (name: ListName) => fetch(`/api/${name}`).then(r => r.json() as Promise<Song[]>)
export const addFavorite = (s: Song) => send('/api/favorites', 'POST', slim(s))
export const removeFavorite = (bm: string) => send(`/api/favorites/${encodeURIComponent(bm)}`, 'DELETE')
export const recordHistory = (s: Song) => send('/api/history', 'POST', slim(s))
