// Replays a fake night against a temp db and checks the usage log. Run: node --test mock/stats.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { setDbDir } from '../server/db.ts'
import { boxFail, boxOk, clock, setPlaying, touch, track } from '../server/stats.ts'

const dir = mkdtempSync(join(tmpdir(), 'ktv-stats-'))
setDbDir(dir)
let t = 1_000_000
clock.now = () => t
const MIN = 60_000

function request(method: string, url: string, headers: Record<string, string> = {}, song?: { sONGBM: string; sONGNAME: string; sINGER: string }) {
  const res = Object.assign(new EventEmitter(), { statusCode: 200 })
  const u = new URL(url, 'http://x'), meta = { song }
  track({ method, headers } as never, res as never, u.pathname, u.searchParams, u.search.slice(1), meta)
  res.emit('finish')
}
const rows = () => new DatabaseSync(join(dir, 'ktv.db')).prepare('SELECT * FROM events ORDER BY id').all() as Record<string, any>[]

test('a night at the box', () => {
  boxOk() // first connection opens the session
  assert.deepEqual(rows().map(r => r.type), ['session_start', 'box_connect'])
  const night = rows()[0].session
  assert.equal(rows()[1].session, night)

  t += MIN
  request('GET', '/api/queue') // polling and plain list reads are not logged
  request('GET', '/api/favorites')
  request('GET', '/api/songs?q=a&songType=9', { 'x-client': 'abc', 'user-agent': 'phone' })
  request('POST', '/api/queue/songs', { 'x-client': 'abc', 'x-origin': 'songs' }, { sONGBM: '1', sONGNAME: 'Song', sINGER: 'Singer' })
  request('GET', '/api/favorites?category=none', { 'x-origin': 'bogus' })
  const types = rows().slice(2).map(r => r.type)
  assert.deepEqual(types, ['client_seen', 'request', 'request', 'request'])
  const add = rows().find(r => r.method === 'POST')!
  assert.equal(add.origin, 'songs'); assert.equal(add.song_name, 'Song'); assert.equal(add.client, 'abc'); assert.equal(add.session, night)
  assert.equal(rows().at(-1)!.origin, null) // not one of songs/favorites/history
  assert.equal(rows().at(-1)!.query, 'category=none')

  setPlaying({ sONGBM: '1', sONGNAME: 'Song', sINGER: 'Singer' })
  t += 10 * MIN // each song start restarts the idle clock, so a long queue keeps the session alive
  setPlaying({ sONGBM: '2', sONGNAME: 'Two', sINGER: 'Singer' })
  t += 10 * MIN
  setPlaying({ sONGBM: '3', sONGNAME: 'Three', sINGER: 'Singer' })
  assert.deepEqual(rows().slice(-2).map(r => r.type), ['song_stop', 'song_start'])
  assert.equal(rows().filter(r => r.type === 'session_end').length, 0)
  assert.equal(rows().at(-1)!.session, night)

  t += 16 * MIN // nothing for 16 minutes: the next activity starts a new session, the old one ended at last + 15
  const lastActive = t - 16 * MIN
  touch()
  const end = rows().find(r => r.type === 'session_end')!
  assert.equal(end.ts, lastActive + 15 * MIN); assert.equal(JSON.parse(end.data).reason, 'idle')
  const second = rows().at(-1)!
  assert.equal(second.type, 'session_start'); assert.notEqual(second.session, night)

  // box lost: 60 seconds of failures
  assert.equal(boxFail(), false)
  t += 61_000
  assert.equal(boxFail(), true)
  const tail = rows().slice(-3)
  assert.deepEqual(tail.map(r => r.type), ['song_stop', 'box_disconnect', 'session_end'])
  assert.equal(JSON.parse(tail[2].data).reason, 'box_lost')
  assert.ok(rows().every(r => r.v === 1 && typeof r.ts === 'number'))
})
