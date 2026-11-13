import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

import { ktv } from './server/ktv.ts'

// Same /demo proxy + /api/host + /api/scan as production (server/serve.ts). KTV_HOST seeds the address.
const link = { name: 'ktv-link', configureServer: (s: any) => { s.middlewares.use(ktv) }, configurePreviewServer: (s: any) => { s.middlewares.use(ktv) } }

export default defineConfig({
  plugins: [react(), tailwindcss(), link],
  server: { host: true },
  preview: { host: true },
})
