# Run the whole project with Docker

Install Docker Engine with Compose v2, or Docker Desktop in Linux container
mode. Run all commands from the repository root. Node.js is not required on
the host. The frontend build and backend dependencies use their existing npm
lockfiles. The backend image compiles strict TypeScript in a build stage and
runs `dist/server.js` with production dependencies only. Migration and admin
commands also use compiled files; Docker users do not need a separate build command.

## First start

Copy `.env.example` to `.env` (`Copy-Item .env.example .env` in PowerShell,
or `cp .env.example .env` on Linux). Generate two separate secrets:

```sh
docker run --rm node:24-bookworm-slim node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

or

```sh
$secret = docker run --rm node:24-bookworm-slim node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"

if ($LASTEXITCODE -eq 0 -and $secret -match '^[a-f0-9]{64}$') {
    $content = Get-Content .env -Raw
    $content -replace '(?m)^JWT_SECRET=.*$', "JWT_SECRET=$secret" |
        Set-Content .env -Encoding utf8
}
```

Run that command twice. Set `POSTGRES_PASSWORD` to the first value and
`JWT_SECRET` to the second in the root `.env`. Use hexadecimal passwords so
the password is also safe inside the database connection URL. Keep this file
private; it is ignored by Git and excluded from Docker builds. Compose injects
the environment; `backend/.env` is not used by the containers.

```sh
docker compose up -d --build --wait
docker compose exec backend npm run admin:bootstrap -- --name "Support Owner" --email "owner@example.com"
```

Open the private setup path printed by the bootstrap command under
`http://localhost:8080`, choose a password, then visit `/login`. The visitor
chat is at `http://localhost:8080/widget`. No default admin password is created.
An expired initial setup link can be reissued:

```sh
docker compose exec backend npm run admin:bootstrap -- --reissue --email "owner@example.com"
```

The stack contains Nginx with the compiled React app, one Node.js API/Socket.IO
process, PostgreSQL 17, Redis 7.4, and a one-shot migration service. PostgreSQL
initializes `backend/schema.sql` only when its named volume is empty. The
migration service applies the existing additive migrations before the backend
starts; migration failure blocks startup. Redis is ephemeral. Only Nginx's
port is published, bound to host loopback by default.

## Check and operate

```sh
docker compose ps -a
docker compose logs --tail=100 backend migrate web
docker compose exec backend node -e "fetch('http://127.0.0.1:3001/ready').then(async r => { console.log(await r.text()); process.exit(r.ok ? 0 : 1); })"
docker compose exec web nginx -t
docker compose stop
docker compose up -d --wait
```

Verify agent and visitor messages, refresh recovery, and reconnection after
`docker compose restart backend`. `/login` must work on a direct browser visit.
`/api/settings` should return JSON and `/socket.io/?EIO=4&transport=polling`
should return an Engine.IO handshake. The web health check tests Nginx; backend
readiness tests PostgreSQL and Redis separately.

`docker compose down` removes containers but preserves PostgreSQL's named
volume. **Do not use `down -v` for an installation whose messages you need:**
it deletes that storage. This stack creates its own database; it does not
automatically import an existing local or hosted database. Changing the
password in `.env` does not change a password already stored in PostgreSQL.

## Updates and backups

Before an update, back up the database and preserve `.env` securely. These
commands avoid binary redirection in Windows PowerShell:

```sh
docker compose exec postgres pg_dump -U livechat -d livechat -Fc -f /tmp/livechat-backup.dump
docker compose cp postgres:/tmp/livechat-backup.dump ./livechat-backup.dump
```

Move the backup to private storage outside the repository and test restoration
into a separate database. Backups contain private chat data.

After pulling reviewed code, build first, stop application traffic, explicitly
run migrations, and start again. Stop on any failed command:

```sh
docker compose build
docker compose stop web backend
docker compose run --rm migrate
docker compose up -d --wait
```

This simple update procedure has downtime. A code rollback requires a compatible
database schema; it must not overwrite newer messages with an older backup.

## Hosting on a server

Use the same repository and commands on a Docker host. Put an HTTPS reverse
proxy in front of `127.0.0.1:8080`, forwarding all paths and WebSocket upgrades.
Set `ALLOWED_ORIGINS=https://chat.example.com` in `.env` and recreate the stack
with `docker compose up -d --wait`. TLS is supplied by that external proxy;
this Compose file alone serves HTTP. Keep the default loopback binding when
the proxy runs on the host. `BIND_ADDRESS` and `HTTP_PORT` can be changed for
other network layouts; update allowed origins when changing the browser URL.

Do not scale the backend beyond one process: the existing presence and event
coordination are not configured for multiple replicas. As in the manual
[AWS deployment](aws-deployment.md), backend limits identify the proxy rather
than individual clients and are shared across users; stored visitor IPs also
identify the proxy. Resolve and test proxy trust before a busy deployment.
Keep database and Redis ports private. Add host monitoring, off-host backups,
and HTTPS before public use.

Startup ordering follows [Compose's health and completion conditions](https://docs.docker.com/compose/how-tos/startup-order/).
Nginx forwards WebSocket upgrades and uses 75-second timeouts according to
[Socket.IO's reverse-proxy requirements](https://socket.io/docs/v4/reverse-proxy/).
