// Stand-in for the box's :8084 for a firewall port-forward: the QR's landing page goes to this app, everything else is proxied to the real box.
// Deliberately NOT on 8084, so the LAN scan never mistakes it for a box. Plain HTTP only (no websocket upgrades).
import http, { type IncomingMessage, type ServerResponse } from 'node:http'
import { boxHost, qrTarget } from './ktv.ts'

export function shim(req: IncomingMessage, res: ServerResponse) {
  if ((req.url ?? '').split('?')[0] === '/demo/en_us_index.html') {
    // Default (no URL set in Settings): localAddress is this server's own IP as the phone reached it (the Host header still says the box)
    const location = qrTarget() || `http://${req.socket.localAddress?.replace('::ffff:', '')}:${process.env.PORT ?? 8080}/`
    res.writeHead(302, { location }).end()
    return
  }
  const box = boxHost()
  if (!box) return void res.writeHead(503).end('no box configured')
  const up = http.request(box + (req.url ?? '/'), { method: req.method, headers: req.headers }, r => {
    res.writeHead(r.statusCode ?? 502, r.headers)
    r.pipe(res)
  })
  up.on('error', () => res.headersSent ? res.destroy() : res.writeHead(502).end('box unreachable'))
  req.pipe(up)
}
