# ktv-proxy

React + Vite + Tailwind front end for the Jetty KTV servlets (`/demo/*Servlet`).

- Dev: `npm run dev` (set `KTV_HOST=http://192.168.100.80:8084` to preset the box; otherwise the landing page asks)
- Build: `npm run build` -> `dist/`
- Run: `npm start` (serves `dist/` on `$PORT`, default 8080)

## How it connects
`server/ktv.ts` runs in both dev and `npm start`. It proxies `/demo/*` to the box (same origin, so no CORS or
mixed content) and exposes `GET/POST /api/host` and `GET /api/scan` (sweeps the server's own /24 for port 8084).
The chosen address is saved to `ktv-config.json` (`$KTV_CONFIG`). The landing page appears on a fresh install
or after 3 failed polls (~9s). Only LAN IPv4 addresses are accepted. The scan covers only the server's own /24,
so an LXC on another VLAN won't find the box and the address has to be typed.

## LXC deploy
Install Node 24+, `npm ci && npm run build`, run `npm start` (e.g. as a systemd service) and point Caddy at it:

    ktv.example.lan { reverse_proxy 127.0.0.1:8080 }

## Proxmox helper script
`lxc/ct/ktv.sh` + `lxc/install/ktv-install.sh` follow the community-scripts layout (they are not part of that project).
1. The repo must be readable by the container (public, or put a token in `KTV_REPO`); it is private by default.
2. On the Proxmox host:

       export COMMUNITY_SCRIPTS_URL=https://raw.githubusercontent.com/ethereal-sheep/ktv-proxy/main/lxc
       bash -c "$(curl -fsSL $COMMUNITY_SCRIPTS_URL/ct/ktv.sh)"

   Or copy `lxc/` to the host and run `bash lxc/ct/ktv.sh`.
3. To update, run the same script again and choose Update.

## Docker
`docker compose up -d --build` serves on :8080. It uses host networking (Linux) so the network scan sees your LAN;
the saved box address persists in the `ktv-data` volume. Update with `docker compose up -d --build`.
