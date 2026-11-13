// Production server: static dist/ + the KTV link. Run with `npm start` (PORT, KTV_HOST, KTV_CONFIG optional).
import http from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { ktv } from './ktv.ts'

const root = join(import.meta.dirname, '..', 'dist')
const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' }

http.createServer((req, res) => ktv(req, res, () => {
  const path = normalize(decodeURIComponent((req.url ?? '/').split('?')[0])).replace(/^(\.\.[/\\])+/, '')
  let file = join(root, path)
  if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) file = join(root, 'index.html') // SPA fallback
  res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' })
  createReadStream(file).pipe(res)
})).listen(+(process.env.PORT ?? 8080), () => console.log('KTV remote on :' + (process.env.PORT ?? 8080)))
