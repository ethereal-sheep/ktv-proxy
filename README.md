# ktv-proxy

React + Vite + Tailwind front end for the Jetty KTV servlets (`/demo/*Servlet`), with a small Node server that
proxies the box on the same origin.

## Installation

Either option serves the app on port 8080. On first visit, enter the KTV machine's IP or use **Search my network**.

### Docker

```sh
git clone https://github.com/ethereal-sheep/ktv-proxy.git
cd ktv-proxy
docker compose up -d --build
```

- Open `http://<docker-host>:8080`.
- `compose.yaml` uses host networking (Linux only) so the network scan sees your LAN. On Docker Desktop, remove
  `network_mode: host`, uncomment `ports: ["8080:8080"]`, and type the box's IP instead.
- The saved address lives in the `ktv-data` volume. To preset it, uncomment `KTV_HOST` in `compose.yaml`.
- Update: `git pull && docker compose up -d --build`.

### Proxmox LXC

Run on the **Proxmox host shell** as root. It creates a Debian 13 LXC (1 core, 1 GB RAM for the build, 4 GB disk),
installs Node 24, builds the app and starts a `ktv` systemd service.

```sh
bash -c "$(curl -fsSL https://raw.githubusercontent.com/ethereal-sheep/ktv-proxy/main/lxc/ct/ktv.sh)"
```

- Or clone the repo on the host and run `bash lxc/ct/ktv.sh`.
- The container must reach the box, so put it on the same bridge/VLAN. Choose *Advanced* in the installer for a
  static IP, storage pool or CTID.
- Update: run the same command again and choose **Update**. The saved address in `/var/lib/ktv` is kept.
- The repo must be readable by the container: make it public, or put a token in `KTV_REPO` in
  `lxc/install/ktv-install.sh`. The scripts follow the community-scripts layout but are not part of that project.

### Reverse proxy (optional)

Point Caddy (or similar) at the container, LAN-only: `POST /api/host` has no authentication.

```
ktv.example.lan { reverse_proxy <container-ip>:8080 }
```

### Manual

Node 24+: `npm ci && npm run build && npm start` (`PORT`, `KTV_HOST` and `KTV_CONFIG` are optional env vars).

## Development

- `npm run dev` (set `KTV_HOST=http://192.168.100.80:8084` to preset the box; otherwise the landing page asks)
- `npm run build` -> `dist/`

## How it connects

`server/ktv.ts` runs in both dev and `npm start`. It proxies `/demo/*` to the box (same origin, so no CORS or
mixed content) and exposes `GET/POST /api/host` and `GET /api/scan` (sweeps the server's own /24 for port 8084).
The chosen address is saved to `ktv-config.json` (`$KTV_CONFIG`). The landing page appears on a fresh install
or after 3 failed polls (~9s). Only LAN IPv4 addresses are accepted. The scan covers only the server's own /24,
so a server on another VLAN won't find the box and the address has to be typed.
