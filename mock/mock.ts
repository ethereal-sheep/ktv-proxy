// Fake KTV box for `npm run dev:mock`: every action works without hardware. Gitignored; imported only when KTV_MOCK=1.
import type { ServerResponse } from 'node:http'

const SONGS = Array.from({ length: 60 }, (_, i) => ({ sONGBM: String(1000 + i), sONGNAME: `Mock Song ${i + 1}`, sINGER: ['Alice', 'Bob', 'Carol'][i % 3], cLOUD: i % 10 === 9 ? 1 : 0 }))
const SINGERS = ['Alice', 'Bob', 'Carol'].map(name => ({ name, picture: name + '.svg' }))
const mockQueue: typeof SONGS = []
export function mock(url: string, res: ServerResponse) {
  const u = new URL(url, 'http://x'), q = u.searchParams, page = +(q.get('page') ?? 0), size = 10
  const out = (o: object) => { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(`cb(${JSON.stringify(o)})`) }
  const paged = <T,>(l: T[]) => ({ list: JSON.stringify(l.slice(page * size, (page + 1) * size)), maxPage: Math.max(1, Math.ceil(l.length / size)) })
  if (u.pathname.startsWith('/demo/singer/')) { res.writeHead(200, { 'content-type': 'image/svg+xml' }); return void res.end('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#888"/></svg>') }
  if (u.pathname.endsWith('/SearchServlet')) {
    const n = (q.get('songName') ?? '').toLowerCase(), s = q.get('singer') ?? ''
    const r = paged(SONGS.filter(x => x.sONGNAME.toLowerCase().includes(n) && (!s || x.sINGER === s)))
    return out({ songList: r.list, maxPage: r.maxPage })
  }
  if (u.pathname.endsWith('/SingerServlet')) { const r = paged(SINGERS); return out({ singerList: r.list, maxPage: r.maxPage }) }
  if (u.pathname.endsWith('/PlaylistServlet')) return out({ songList: JSON.stringify(mockQueue), number: mockQueue.length })
  if (u.pathname.endsWith('/CommandServlet')) {
    const song = SONGS.find(x => x.sONGBM === q.get('cmdValue'))
    if (q.get('cmd') === 'Add1' && song) mockQueue.push(song)
    return out({})
  }
  res.writeHead(404); res.end()
}

