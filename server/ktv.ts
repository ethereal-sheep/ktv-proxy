// Runtime-configurable link to the KTV box: proxies /demo, stores the box address, and scans the LAN for it.
import http, { type IncomingMessage, type ServerResponse } from 'node:http'
import { networkInterfaces } from 'node:os'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { addFavorite, isSong, listSongs, recordHistory, removeFavorite, setDbDir } from './db.ts'

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

const json = (res: ServerResponse, code: number, body: unknown) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
const readBody = (req: IncomingMessage) => new Promise<string>(r => { let b = ''; req.on('data', d => (b += d)); req.on('end', () => r(b)) })

export function ktv(req: IncomingMessage, res: ServerResponse, next: () => void) {
  const url = req.url ?? ''
  if (url.startsWith('/demo/')) {
    if (MOCK) return mock(url, res)
    if (!host) return json(res, 503, { error: 'no host configured' })
    const t = new URL(host)
    const up = http.request({ host: t.hostname, port: t.port, path: url, method: req.method, headers: { ...req.headers, host: t.host }, timeout: 8000 }, r => {
      res.writeHead(r.statusCode ?? 502, r.headers); r.pipe(res)
    })
    up.on('timeout', () => up.destroy()).on('error', () => { if (!res.headersSent) json(res, 502, { error: 'unreachable' }); else res.end() })
    return void req.pipe(up)
  }
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
  // Favorites and history live in SQLite (server/db.ts); each action is one row operation, so devices can't overwrite each other's lists.
  const list = url.match(/^\/api\/(favorites|history)(?:\/([^/]+))?$/)
  if (list) {
    const [, name, bm] = list
    if (req.method === 'GET' && !bm) return json(res, 200, listSongs(name as 'favorites' | 'history'))
    if (req.method === 'DELETE' && bm && name === 'favorites') { removeFavorite(decodeURIComponent(bm)); return json(res, 200, {}) }
    if (req.method === 'POST' && !bm) return void readBody(req).then(b => {
      let song: unknown
      try { song = JSON.parse(b) } catch { /* falls through to the 400 */ }
      if (!isSong(song)) return json(res, 400, { error: 'expected a song' })
      try { (name === 'favorites' ? addFavorite : recordHistory)(song) } catch (e) { console.error('could not save ' + name, e); return json(res, 500, { error: 'could not save' }) }
      json(res, 200, {})
    })
  }
  if (url === '/api/scan') return void scan().then(found => json(res, 200, { found }))
  next()
}
