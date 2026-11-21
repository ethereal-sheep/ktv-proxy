// Swagger UI at /api/docs (assets from the unpkg CDN, so the browser needs internet) + the spec at /api/openapi.json.
const op = (summary: string, extra: object = {}) => ({ summary, responses: { 200: { description: 'OK' } }, ...extra })
const idParam = (name: string, where = 'path') => ({ name, in: where, required: true, schema: { type: 'string' } })
const body = (props: object) => ({ requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: props } } } } })
const q = (...names: string[]) => names.map(n => idParam(n, 'query')).map(p => ({ ...p, required: false }))

const spec = {
  openapi: '3.0.3', info: { title: 'KTV remote API', version: '0.0.0' },
  paths: {
    '/api/host': { get: op('Current box address'), post: op('Set the box address', body({ host: { type: 'string' } })) },
    '/api/id': { get: op('Random id of this server process (CORS-open, for checking a URL reaches this server)') },
    '/api/qr': { get: op('Where the QR shim redirects (empty = this server)'), post: op('Set the QR redirect URL', body({ url: { type: 'string' } })) },
    '/api/songs': { get: op('Search songs', { parameters: q('q', 'songType', 'singer', 'lang', 'sortType', 'page') }) },
    '/api/singers': { get: op('Search singers', { parameters: q('q', 'type', 'page') }) },
    '/api/singers/picture/{id}': { get: op('Singer picture', { parameters: [idParam('id')] }) },
    '/api/queue': { get: op('Queue and current song') },
    '/api/queue/songs': { post: op('Add a song (also records it in history when `song` is given)', body({ id: { type: 'string' }, next: { type: 'boolean' }, cloud: { type: 'boolean' }, song: { type: 'object' } })) },
    '/api/queue/songs/{key}': { post: op('Move a queued song to play next', { parameters: [idParam('key')] }), delete: op('Remove a queued song', { parameters: [idParam('key')] }) },
    '/api/player/{action}': { post: op('Remote-control button', { parameters: [idParam('action')] }) },
    '/api/favorites': { get: op('List favorites', { parameters: q('q', 'category') }), delete: op('Clear all favorites'), post: op('Add a favorite', body({ sONGBM: { type: 'string' } })) },
    '/api/favorites/{id}': { delete: op('Remove a favorite', { parameters: [idParam('id')] }) },
    '/api/favorites/{id}/categories/{cat}': { put: op('Put favorite in category', { parameters: [idParam('id'), idParam('cat')] }), delete: op('Take favorite out of category', { parameters: [idParam('id'), idParam('cat')] }) },
    '/api/history': { get: op('List history', { parameters: q('q') }), delete: op('Clear history') },
    '/api/categories': { get: op('List categories'), post: op('Add a category', body({ name: { type: 'string' } })) },
    '/api/categories/order': { put: op('Reorder categories', body({ ids: { type: 'array', items: { type: 'integer' } } })) },
    '/api/categories/{id}': { patch: op('Rename a category', { parameters: [idParam('id')], ...body({ name: { type: 'string' } }) }), delete: op('Delete a category', { parameters: [idParam('id'), { ...idParam('songs', 'query'), required: false, schema: { type: 'string', enum: ['keep', 'orphans', 'all'] } }] }) },
    '/api/scan': { get: op('Scan the LAN for the box') },
  },
}

const page = `<!doctype html><title>KTV API</title><link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css"><div id="ui"></div><script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script><script>SwaggerUIBundle({url:'/api/openapi.json',dom_id:'#ui'})</script>`

export function docs(path: string, res: import('node:http').ServerResponse): boolean {
  if (path === '/api/openapi.json') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(spec)); return true }
  if (path === '/api/docs') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(page); return true }
  return false
}
