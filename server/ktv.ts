// Runtime-configurable link to the KTV box: proxies /demo, stores the box address, and scans the LAN for it.
import http, { type IncomingMessage, type ServerResponse } from 'node:http'
import { networkInterfaces } from 'node:os'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { match } from 'pinyin-pro'
import { docs } from './docs.ts'
import { boxFail, boxOk, setPlaying, track, type Meta } from './stats.ts'
import { clearFavorites, clearHistory, addCategory, addFavorite, cleanName, deleteCategory, isSong, type Song, reorderCategories, listCategories, listFavorites, listHistory, recordHistory, removeFavorite, renameCategory, setDbDir, setSongCategory } from './db.ts'

const PORT = 8084
const PROBE = '/demo/PlaylistServlet?onSelectPage=true&jsonpCallback=cb'

// Local debug only (npm run dev:mock): a fake box from ./mock/. Its favorites/history go to mock/data/ (gitignored), never the real db.
const MOCK = process.env.KTV_MOCK === '1' && process.env.NODE_ENV !== 'production'
const CONFIG = process.env.KTV_CONFIG ?? (MOCK ? 'mock/data/config.json' : 'ktv-config.json')
setDbDir(dirname(CONFIG)) // the db sits beside the config, so it shares its volume
const mockUrl: string = pathToFileURL(join(import.meta.dirname, '..', 'mock', 'mock.ts')).href // a variable, so tsc doesn't need the file to exist
const mock: (url: string, res: ServerResponse) => void = MOCK ? (await import(mockUrl)).mock : () => {}

let host: string | null = MOCK ? 'http://mock:8084' : process.env.KTV_HOST ?? null
if (!MOCK) try { host = JSON.parse(readFileSync(CONFIG, 'utf8')).host ?? host } catch { /* no saved config yet */ }

// Only LAN addresses: this endpoint makes the server fetch from whatever it is given.
const isLan = (ip: string) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.|169\.254\.)/.test(ip)

function normalize(input: string): string | null {
  const m = input.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '').match(/^(\d{1,3}(?:\.\d{1,3}){3})(?::(\d{1,5}))?$/)
  if (!m || m[1].split('.').some(n => +n > 255) || !isLan(m[1])) return null
  return `http://${m[1]}:${m[2] ?? PORT}`
}

const probe = (base: string, ms = 1500) => new Promise<boolean>(res => {
  const r = http.get(base + PROBE, { timeout: ms }, resp => {
    let b = ''
    resp.on('data', d => { if (b.length < 512) b += d })
    resp.on('end', () => res(/^\s*cb\(/.test(b)))
  })
  r.on('timeout', () => r.destroy()).on('error', () => res(false))
})

async function scan(): Promise<string[]> {
  const ips: string[] = []
  for (const list of Object.values(networkInterfaces()))
    for (const a of list ?? []) {
      if (a.family !== 'IPv4' || a.internal || !isLan(a.address)) continue
      const p = a.address.split('.').slice(0, 3).join('.') // /24 only: bigger sweeps take too long
      for (let i = 1; i < 255; i++) ips.push(`${p}.${i}`)
    }
  const found: string[] = []
  const queue = [...new Set(ips)]
  await Promise.all(Array.from({ length: 64 }, async () => {
    for (let ip; (ip = queue.pop()); ) if (await probe(`http://${ip}:${PORT}`, 800)) found.push(`http://${ip}:${PORT}`)
  }))
  return found.sort()
}

// The servlets only answer when given a JSONP callback name, so we ask for one and strip the wrapper.
// Timeout (5s) stays under the client's 6s so the server logs the failure first.
function callBox(servlet: string, params: Record<string, string>): Promise<Record<string, string>> {
  const path = `/demo/${servlet}?${new URLSearchParams({ ...params, jsonpCallback: 'cb' })}`
  return new Promise((resolve, reject) => {
    const done = (body?: string) => {
      const m = String(body ?? '').match(/^\s*cb\(([\s\S]*)\)\s*;?\s*$/)
      try { if (!m) throw new Error('unexpected response from box'); resolve(JSON.parse(m[1])) } catch (e) { reject(e) }
    }
    if (MOCK) return mock(path, { writeHead() {}, end: done } as unknown as ServerResponse)
    if (!host) return reject(new Error('no host configured'))
    const t = new URL(host)
    http.get({ host: t.hostname, port: t.port, path, timeout: 5000 }, r => {
      if (r.statusCode !== 200) { r.resume(); return reject(new Error(`box HTTP ${r.statusCode}`)) }
      let b = ''; r.on('data', d => (b += d)); r.on('end', () => done(b))
    }).on('timeout', function (this: http.ClientRequest) { this.destroy(new Error('box timed out')) }).on('error', reject)
  })
}

// Readable names for the box's cryptic CommandServlet codes. Queue edits have their own routes (below); these are the remote-control buttons.
const ACTIONS: Record<string, string> = {
  'toggle-vocal': 'MuOr',
  'skip': 'Skip',
  'replay': 'Reset',
  'play-pause': 'Play',
  'mute': 'Mute',
  'music-volume-up': 'Music_volUp',
  'music-volume-down': 'Music_volDown',
  'music-key-up': 'Music_toneUp',
  'music-key-down': 'Music_toneDown',
  'mic-volume-up': 'Mic_volUp',
  'mic-volume-down': 'Mic_volDown',
  'mic-echo-up': 'Mic_echoUp',
  'mic-echo-down': 'Mic_echoDown',
  'mic-reverb-up': 'Mic_reverbUp',
  'mic-reverb-down': 'Mic_reverbDown',
}

// List fields arrive as JSON strings inside the JSON.
const rows = (d: Record<string, string>, k: string) => JSON.parse(d[k] || '[]')

// The box never says what is playing, so we infer it. /PlaylistServlet lists only upcoming songs, but its `number` also counts
// the playing one (not a cloud song still downloading), so playing = number - items.length. Songs we can't see are tracked in `pending`.
type QSong = Song & { xH?: string }
const qkey = (s: QSong) => String(s.xH ?? s.sONGBM) // the box sends xH as a number; the routes carry it as a string
const UNKNOWN: Song = { sONGBM: '', sONGNAME: '???', sINGER: '???' } // playing, but we never saw which song started
let idleSeen = false // right after a song change the box briefly reports count 1 with the next song still listed, so idle needs two polls
let glitchSeen = false // Pro2 (move to next) re-queues the song, so for ~50ms the box lists nothing while still counting it
let current: Song | null = null, prev: { items: QSong[]; count: number; playing: boolean } | null = null
const pending: { song: Song; cloud: boolean; at: number }[] = [] // adds not yet seen in the queue; cloud ones sit here while downloading
const downloaded = new Set<string>() // cloud songs now stored on the box: they queue like normal songs (lost on restart, then the next request just re-learns it)
const removed = new Set<string>() // keys we sent Del1 for: leaving the head then means deleted, not started
// pending: cloud songs still downloading, which the box doesn't list
const snapshot = (items: QSong[], count: number) => ({ items, count, current, downloaded: [...downloaded], pending: pending.filter(p => p.cloud).map(p => p.song) })
function settle(i: number) { // a pending add is resolved: it queued or started, so a cloud song is stored now
  const [p] = pending.splice(i, 1)
  if (p.cloud) downloaded.add(String(p.song.sONGBM))
  return p
}
async function pollQueue() {
  const d = await callBox('PlaylistServlet', { onSelectPage: 'true' })
  const items: QSong[] = rows(d, 'songList'), playing = +d.number - items.length > 0
  if (!playing && prev?.playing && !idleSeen) { idleSeen = true; return snapshot(items, +d.number) }
  idleSeen = false
  const keys = new Set(items.map(qkey)), seen = new Set(prev?.items.map(qkey))
  for (const s of items) if (!seen.has(qkey(s))) { const i = pending.findIndex(p => p.song.sONGBM === s.sONGBM); if (i >= 0) settle(i) }
  const head = prev?.items[0]
  const headGone = head && !keys.has(qkey(head)) && !removed.has(qkey(head))
  if (headGone && +d.number >= prev!.count && !glitchSeen) { glitchSeen = true; return snapshot(prev!.items, prev!.count) } // a real start lowers the count; skip that poll once
  glitchSeen = false
  if (headGone) current = head
  else if (playing && !prev?.playing) { // started with nothing visible in the queue: the oldest add must have started (non-cloud ones start almost instantly)
    const i = Math.max(0, pending.findIndex(p => !p.cloud))
    current = pending.length ? settle(i).song : UNKNOWN
  }
  if (!playing) current = null
  else current ??= UNKNOWN
  // shortcut: a download that never finishes is dropped after 3 min (a guess; the box took 40-60s)
  for (let i = pending.length; i--; ) if (Date.now() - pending[i].at > 180_000) pending.splice(i, 1)
  for (const k of removed) if (!keys.has(k)) removed.delete(k)
  setPlaying(current)
  prev = { items, count: +d.number, playing }
  return snapshot(items, +d.number)
}
let polling: Promise<unknown> = Promise.resolve() // one poll at a time: the diff needs polls in order
const poll = () => {
  const p = polling.then(pollQueue).then(q => { boxOk(); return q }, e => { if (boxFail()) current = null; throw e })
  polling = p.catch(() => {}); return p
}
const pollQuietly = () => void poll().catch(() => {})
setInterval(pollQuietly, 3000).unref()

const fromBox = (res: ServerResponse, servlet: string, params: Record<string, string>, shape: (d: Record<string, string>) => unknown) =>
  void callBox(servlet, params).then(d => json(res, 200, shape(d))).catch(e => {
    console.error(`box ${servlet} failed:`, e.message)
    json(res, e.message === 'no host configured' ? 503 : 502, { error: e.message })
  })

// Singer pictures are binary, so they are piped through instead of parsed.
function pictureFromBox(res: ServerResponse, name: string) {
  const path = `/demo/singer/${name}`
  if (MOCK) return mock(path, res)
  if (!host) return json(res, 503, { error: 'no host configured' })
  const t = new URL(host)
  http.get({ host: t.hostname, port: t.port, path, timeout: 8000 }, r => { res.writeHead(r.statusCode ?? 502, r.headers); r.pipe(res) })
    .on('timeout', function (this: http.ClientRequest) { this.destroy() }).on('error', () => { if (!res.headersSent) json(res, 502, { error: 'unreachable' }); else res.end() })
}

const json = (res: ServerResponse, code: number, body: unknown) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
const readBody = (req: IncomingMessage) => new Promise<string>(r => { let b = ''; req.on('data', d => (b += d)); req.on('end', () => r(b)) })

export function ktv(req: IncomingMessage, res: ServerResponse, next: () => void) {
  const url = req.url ?? ''
  if (url === '/api/host' && req.method === 'GET') return json(res, 200, { host })
  if (url === '/api/host' && req.method === 'POST') return void readBody(req).then(async b => {
    let input = ''
    try { input = String(JSON.parse(b).host ?? '') } catch { /* falls through to the 400 */ }
    const base = normalize(input)
    if (!base) return json(res, 400, { error: 'Enter a LAN IP address, e.g. 192.168.1.50' })
    if (!(await probe(base, 3000))) return json(res, 422, { error: `Nothing answered like a KTV machine at ${base.replace('http://', '')}` })
    host = base
    try { writeFileSync(CONFIG, JSON.stringify({ host })) } catch (e) { console.error('could not save config', e) }
    json(res, 200, { host })
  })
  const u = new URL(url, 'http://x'), path = u.pathname
  const meta: Meta = {} // filled in by the routes that know which song a request is about
  track(req, res, path, u.searchParams, u.search.slice(1), meta)
  if ((path === '/api/favorites' || path === '/api/history') && req.method === 'DELETE') {
    try { (path === '/api/favorites' ? clearFavorites : clearHistory)() } catch (e) { console.error('could not clear', e); return json(res, 500, { error: 'could not clear' }) }
    return json(res, 200, {})
  }
  if (docs(path, res)) return
  if (path === '/api/categories/order' && req.method === 'PUT') return void readBody(req).then(b => {
    let ids: unknown
    try { ids = JSON.parse(b).ids } catch { /* falls through to the 400 */ }
    if (!Array.isArray(ids) || !ids.length || !ids.every(n => Number.isInteger(n))) return json(res, 400, { error: 'expected ids' })
    try { reorderCategories(ids) } catch (e) { console.error('could not reorder', e); return json(res, 500, { error: 'could not save' }) }
    json(res, 200, {})
  })
  const cat = path.match(/^\/api\/categories(?:\/(\d+))?$/)
  if (cat) {
    const id = cat[1] === undefined ? undefined : +cat[1]
    if (req.method === 'GET' && id === undefined) return json(res, 200, listCategories())
    if (req.method === 'DELETE' && id !== undefined) {
      const songs = new URL(url, 'http://x').searchParams.get('songs') ?? 'keep'
      if (songs !== 'keep' && songs !== 'orphans' && songs !== 'all') return json(res, 400, { error: 'songs must be keep, orphans or all' })
      try { deleteCategory(id, songs) } catch (e) { console.error('could not delete category', e); return json(res, 500, { error: 'could not delete' }) }
      return json(res, 200, {})
    }
    if ((req.method === 'POST' && id === undefined) || (req.method === 'PATCH' && id !== undefined)) return void readBody(req).then(b => {
      let name: string | null = null
      try { name = cleanName(JSON.parse(b).name) } catch { /* falls through to the 400 */ }
      if (!name) return json(res, 400, { error: 'Enter a name of up to 50 characters' })
      try {
        const row = id === undefined ? addCategory(name) : renameCategory(id, name)
        json(res, row ? 200 : 404, row ?? { error: 'no such category' })
      } catch (e) {
        if (/UNIQUE/.test(String(e))) return json(res, 409, { error: `"${name}" already exists` })
        console.error('could not save category', e); json(res, 500, { error: 'could not save' })
      }
    })
  }
  const link = path.match(/^\/api\/favorites\/([^/]+)\/categories\/(\d+)$/)
  if (link && (req.method === 'PUT' || req.method === 'DELETE')) {
    try { setSongCategory(decodeURIComponent(link[1]), +link[2], req.method === 'PUT') } catch { return json(res, 404, { error: 'unknown favorite or category' }) }
    return json(res, 200, {})
  }
  // Favorites and history live in SQLite (server/db.ts); each action is one row operation, so devices can't overwrite each other's lists.
  const list = path.match(/^\/api\/(favorites|history)(?:\/([^/]+))?$/)
  if (list) {
    const [, name, bm] = list
    if (req.method === 'GET' && !bm) {
      const all = name === 'favorites' ? listFavorites() : listHistory() as Song[]
      const q = (u.searchParams.get('q') ?? '').trim().toLowerCase()
      const cat = u.searchParams.get('category') // favorites only: a category id, or "none" for Uncategorized
      if (cat !== null && cat !== 'none' && !/^\d+$/.test(cat)) return json(res, 400, { error: 'category must be an id or none' })
      const inCat = (s: Song & { cats?: number[] }) => name !== 'favorites' || cat === null || (cat === 'none' ? !s.cats?.length : !!s.cats?.includes(+cat))
      // q: plain text, or pinyin / initials like the box's own search (done here so the browser doesn't ship the pinyin table)
      return json(res, 200, all.filter(s => inCat(s) && (!q || [s.sONGNAME, s.sINGER].some(t => t.toLowerCase().includes(q) || match(t, q)))))
    }
    if (req.method === 'DELETE' && bm && name === 'favorites') { meta.song = { sONGBM: decodeURIComponent(bm) }; removeFavorite(decodeURIComponent(bm)); return json(res, 200, {}) }
    if (req.method === 'POST' && !bm && name === 'favorites') return void readBody(req).then(b => {
      let song: unknown
      try { song = JSON.parse(b) } catch { /* falls through to the 400 */ }
      if (!isSong(song)) return json(res, 400, { error: 'expected a song' })
      meta.song = song
      try { addFavorite(song) } catch (e) { console.error('could not save favorite', e); return json(res, 500, { error: 'could not save' }) }
      json(res, 200, {})
    })
  }
  // The box's servlets are only ever called from here; the browser sees plain /api/* routes.
  const sp = new URL(url, 'http://x').searchParams, g = (k: string) => sp.get(k) ?? ''
  if (path === '/api/songs' && req.method === 'GET') return fromBox(res, 'SearchServlet',
    { songName: g('q'), songType: g('songType'), singer: g('singer'), lang: g('lang'), sortType: g('sortType'), page: g('page') || '0' }, d => ({ items: rows(d, 'songList'), maxPage: +d.maxPage }))
  if (path === '/api/singers' && req.method === 'GET') return fromBox(res, 'SingerServlet',
    { singer: g('q'), singerType: g('type'), sortType: '', page: g('page') || '0' }, d => ({ items: rows(d, 'singerList'), maxPage: +d.maxPage }))
  // items and current come from the same box reading, so they never disagree
  if (path === '/api/queue' && req.method === 'GET') return void poll().then(q => json(res, 200, q)).catch(e => {
    console.error('box PlaylistServlet failed:', e.message)
    json(res, e.message === 'no host configured' ? 503 : 502, { error: e.message })
  })
  // Songs are addressed by id (sONGBM) when adding, and by queue key (xH) once queued.
  const command = (cmd: string, cmdValue: string, add?: { song: Song; cloud: boolean }, record?: Song) => {
    if (cmd === 'Del1') removed.add(cmdValue)
    if (add) pending.push({ ...add, at: Date.now() })
    fromBox(res, 'CommandServlet', { cmd, cmdValue }, d => { // a requested song counts as history once the box accepted it
      if (record) try { recordHistory(record) } catch (e) { console.error('could not save history', e) }
      return d
    })
    pollQuietly() // pick up the change now instead of in 3s
  }
  if (path === '/api/queue/songs' && req.method === 'POST') return void readBody(req).then(b => {
    let c: { id?: unknown; next?: unknown; cloud?: unknown; song?: unknown } = {}
    try { c = JSON.parse(b) } catch { /* falls through to the 400 */ }
    if (typeof c.id !== 'string' || !c.id) return json(res, 400, { error: 'expected id' })
    const cloud = c.cloud === true && !downloaded.has(c.id)
    if (cloud && pending.some(p => p.cloud && p.song.sONGBM === c.id)) return json(res, 409, { error: 'already downloading' }) // the box ignores a second request while one is downloading
    meta.song = isSong(c.song) ? c.song : { sONGBM: c.id }; meta.data = { next: !!c.next, cloud }
    command(c.next ? 'Pro1' : 'Add1', c.id, { song: isSong(c.song) ? c.song : { ...UNKNOWN, sONGBM: c.id }, cloud }, isSong(c.song) ? c.song : undefined)
  })
  const queued = path.match(/^\/api\/queue\/songs\/([^/]+)$/)
  if (queued && req.method === 'POST') return command('Pro2', decodeURIComponent(queued[1])) // move an already-queued song to play next
  if (queued && req.method === 'DELETE') return command('Del1', decodeURIComponent(queued[1]))
  const act = path.match(/^\/api\/player\/([^/]+)$/)
  if (act && req.method === 'POST') return Object.hasOwn(ACTIONS, act[1]) ? command(ACTIONS[act[1]], '') : json(res, 400, { error: 'unknown action' })
  const pic = path.match(/^\/api\/singers\/picture\/([^/]+)$/)
  if (pic && req.method === 'GET') return pictureFromBox(res, pic[1])
  if (url === '/api/scan') return void scan().then(found => json(res, 200, { found }))
  next()
}
