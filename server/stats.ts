// Usage log: every request worth counting, song start/stop as the poller infers them, and the sessions around them.
// A session is a night at the box, shared by all remotes: it opens on the first box connection or song request, and closes after
// 15 idle minutes (no song request, no song starting or stopping) or when the box has been unreachable for a minute.
import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { insertEvent, type EventRow, type Song } from './db.ts'

const IDLE_MS = 15 * 60_000, LOST_MS = 60_000
export const clock = { now: () => Date.now() } // a hook so tests can move time

let session: string | null = null, last = 0, boxUp = false, failSince = 0, playing: Partial<Song> | null = null
const seen = new Set<string>() // clients seen since the server started

// A logging failure must never break the request that caused it.
function write(e: Omit<EventRow, 'ts'>, ts = clock.now()) {
  try { insertEvent({ session, ...e, ts }) } catch (err) { console.error('could not log event', err) }
}
function end(reason: string, ts: number) {
  if (!session) return
  write({ type: 'session_end', data: { reason } }, ts)
  session = null
}
function expire() { if (session && clock.now() - last >= IDLE_MS) end('idle', last + IDLE_MS) }
setInterval(expire, 30_000).unref()

// Counts as activity: opens a session if there is none and restarts the idle clock.
export function touch() {
  expire()
  if (!session) { session = randomUUID(); write({ type: 'session_start' }) }
  last = clock.now()
  return session
}

// Call after every box reading. The box only counts as lost after a full minute of failures, so a blip stays in the same session.
export function boxOk() {
  failSince = 0
  if (boxUp) return
  boxUp = true
  touch()
  write({ type: 'box_connect' })
}
export function boxFail(): boolean { // true when the box has just been declared lost
  if (!boxUp) return false
  failSince ||= clock.now()
  if (clock.now() - failSince < LOST_MS) return false
  setPlaying(null, failSince)
  write({ type: 'box_disconnect' }, failSince)
  end('box_lost', failSince)
  boxUp = false; failSince = 0
  return true
}

// The inferred playing song, from the queue poller; a change is a stop and/or a start.
export function setPlaying(song: Partial<Song> | null, at?: number) {
  if (song === playing) return
  if (playing) { if (at === undefined) touch(); write({ type: 'song_stop', song: playing }, at) }
  playing = song
  if (song) { touch(); write({ type: 'song_start', song }) }
}

// What a route hands back for the log (the body is read inside the route, after logging has been set up).
export type Meta = { song?: Partial<Song>; data?: Record<string, unknown> }
const ORIGINS = ['songs', 'favorites', 'history'] // which tab a song request came from
const LOGGED = [/^POST \/api\/queue\/songs$/, /^(POST|DELETE) \/api\/queue\/songs\/[^/]+$/, /^POST \/api\/player\/[^/]+$/, /^GET \/api\/(songs|singers)$/,
  /^POST \/api\/favorites$/, /^DELETE \/api\/favorites(\/[^/]+)?$/]

export function track(req: IncomingMessage, res: ServerResponse, path: string, params: URLSearchParams, rawQuery: string, meta: Meta) {
  const method = req.method ?? '', key = `${method} ${path}`
  // list reads happen on every tab change, so only the ones that search or filter count
  const search = method === 'GET' && /^\/api\/(favorites|history)$/.test(path) && (params.get('q') || params.get('category'))
  if (!search && !LOGGED.some(r => r.test(key))) return
  const h = (n: string) => { const v = req.headers[n]; return typeof v === 'string' ? v : null }
  const cid = h('x-client'), o = h('x-origin')
  const client = cid && /^[\w-]{1,64}$/.test(cid) ? cid : null
  const origin = o && ORIGINS.includes(o) ? o : null
  if (key === 'POST /api/queue/songs') touch(); else expire()
  const s = session
  if (client && !seen.has(client)) { seen.add(client); write({ type: 'client_seen', client, data: { ua: h('user-agent') } }) }
  res.on('finish', () => write({ type: 'request', session: s, client, origin, method, path, query: rawQuery, status: res.statusCode, song: meta.song, data: meta.data }))
}
