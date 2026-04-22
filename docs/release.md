# Release and Deployment

This project is deployed in **production mode** at:

- public URL: `https://trussner.com/agi/`
- game transport: `https://trussner.com/agi/colyseus/`

The browser bundle is built for the `/agi/` base path and the Colyseus server is proxied through the same origin, so the release build does **not** use Vite dev mode.

## Publish a Release

From the repo root:

```bash
./scripts/release.sh
```

That script does the whole publish flow:

1. builds the production server and client bundle
2. builds the client with `VITE_PUBLIC_BASE=/agi/`
3. syncs the static files to `/var/www/trussner.com/agi`
4. syncs the server bundle and package manifests to `/opt/vibejam`
5. runs `npm ci --omit=dev` on the server
6. forces the deployed `dist/` tree to CommonJS mode for Node
7. restarts `vibejam.service`
8. checks `https://trussner.com/agi/` and `/agi/colyseus/`

## Release Configuration

The script defaults to the current production server:

- `DEPLOY_HOST=root@reduta`
- `DEPLOY_DOMAIN=https://trussner.com`
- `PUBLIC_BASE=/agi/`
- `REMOTE_APP_DIR=/opt/vibejam`
- `REMOTE_STATIC_DIR=/var/www/trussner.com/agi`
- `REMOTE_SERVICE_NAME=vibejam.service`

You can override them for another server:

```bash
DEPLOY_HOST=root@example.com \
DEPLOY_DOMAIN=https://example.com \
PUBLIC_BASE=/agi/ \
./scripts/release.sh
```

## Server Layout

Production files live in two places:

- `/var/www/trussner.com/agi`
  Static Vite build served by Nginx
- `/opt/vibejam`
  Node app, compiled server output, and production dependencies

The long-running process is:

- `vibejam.service`
  Runs `node /opt/vibejam/dist/server/src/index.js`

Useful commands:

```bash
ssh root@reduta
systemctl status vibejam.service
journalctl -u vibejam.service -n 100 --no-pager
systemctl restart vibejam.service
```

## Nginx Setup

`trussner.com` already has its main site configured. The game is mounted as a subpath inside `/etc/nginx/sites-available/trussner.com`.

Relevant locations:

```nginx
location = /agi {
    return 301 /agi/;
}

location = /agi/index.html {
    root /var/www/trussner.com;
    add_header Cache-Control "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0" always;
    expires -1;
    try_files $uri =404;
}

location = /agi/ {
    root /var/www/trussner.com;
    add_header Cache-Control "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0" always;
    expires -1;
    try_files /agi/index.html =404;
}

location ^~ /agi/colyseus/ {
    proxy_pass http://127.0.0.1:2567/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 60s;
}

location ^~ /agi/assets/ {
    root /var/www/trussner.com;
    add_header Cache-Control "public, max-age=31536000, immutable" always;
    expires 1y;
    try_files $uri =404;
}

location ^~ /agi/models/ {
    root /var/www/trussner.com;
    add_header Cache-Control "public, max-age=31536000, immutable" always;
    expires 1y;
    try_files $uri =404;
}
```

The split matters:

- `/agi/` and `/agi/index.html` must not be cached, so clients always fetch the latest entry HTML after a deploy.
- hashed assets under `/agi/assets/` and static models under `/agi/models/` should be cached aggressively.
- `/agi/colyseus/` stays proxied to the Node server.

## Why `dist/package.json` Exists

The TypeScript server build is emitted as CommonJS. The repo root is ESM (`"type": "module"`), so the deployed `dist/` directory needs its own:

```json
{"type":"commonjs"}
```

The release script writes that file on the server before restarting the service.

## Related Code

- [client/vite.config.ts](/Users/tim/Code/vibejam/client/vite.config.ts)
- [client/src/network.ts](/Users/tim/Code/vibejam/client/src/network.ts)
- [scripts/release.sh](/Users/tim/Code/vibejam/scripts/release.sh)
