# Live Chat Customer Support System

A self-hosted support inbox and visitor chat widget built with React, TypeScript,
Vite, Express, Socket.IO, PostgreSQL, and Redis. See [FEATURE.md](FEATURE.md) for
implemented features and remaining extensions.

## Structure

- `frontend/src/pages/`: routes and page layout.
- `frontend/src/features/`: authentication, inbox, socket lifecycle, and message hooks.
- `frontend/src/components/`: shared message list, composer, and UI controls.
- `frontend/src/lib/`: public TypeScript contracts, response validation, and HTTP helpers.
- `backend/server.js`: validated configuration, infrastructure startup, and shutdown.
- `backend/src/app.js`: HTTP routes and error responses; can be constructed without listening.
- `backend/src/realtime.js`: socket authentication and event registration.
- `backend/src/chat.service.js`: ownership checks, conversation rules, and transactions.
- `backend/src/chat.repository.js`: parameterized PostgreSQL queries and persistence.
- `backend/src/presence.js`: connection-aware availability and multiple-tab behavior.
- `backend/migrations/`: additive changes for existing databases.
- `backend/test/`: regression tests and isolated PostgreSQL integration tests.
- `docs/realtime.md`: transport contracts, ordering, recovery, and operational limits.

## Local setup

For a new PC, follow [Clone and install locally](docs/local-installation.md) for
required applications and versions, Windows setup, PostgreSQL/Redis, agent
creation, and verification commands.

Use npm in each package. Development was verified with Node.js 24. PostgreSQL and
Redis must be available locally; PostgreSQL is the durable source of truth.

1. Create a database and initialize a **new** installation:

   ```sh
   createdb livechat
   psql -d livechat -f backend/schema.sql
   ```

   For an **existing** installation, apply the additive migration instead:

   ```sh
   cd backend
   npm run db:migrate
   ```

   The command reads `DATABASE_URL` from `backend/.env` and does not require the
   `psql` command. The migration preserves existing conversations and messages.
   The backend checks for the new
   column before accepting traffic; it does not run migrations automatically.

2. In `backend`, run `npm ci`, copy `.env.example` to `.env`, and set:

   - `DATABASE_URL`: PostgreSQL connection URL.
   - `REDIS_URL`: Redis connection URL.
   - `JWT_SECRET`: unique random secret of at least 32 characters. Changing it
     invalidates existing sessions. Generate one using
     `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.
   - `ALLOWED_ORIGINS`: comma-separated browser origins, without paths or trailing
     slashes. Defaults to local Vite origins in development; required in production.
   - `PORT`: defaults to `3001`.

3. Provision the first super admin from the backend directory:

   ```sh
   npm run admin:bootstrap -- --name "Support Owner" --email "owner@example.com"
   ```

   The command prints a private, single-use `/set-password#token=...` path.
   After starting the frontend/backend, open that path on the frontend host,
   choose a password, and sign in. Open **Manage agents** to create invitations,
   edit capacity, deactivate/reactivate agents, and issue password resets.
   There are no default credentials or public registration endpoints.
   See [Priority 1 setup and permissions](docs/agent-ownership.md).

4. Start the backend with `npm run dev` or `npm start` from `backend`.
5. In `frontend`, run `npm ci` and `npm run dev`.
6. Open `http://localhost:5173/login` for the agent inbox or
   `http://localhost:5173/widget` for the visitor widget.

The Vite development proxy forwards `/api` and `/socket.io` to port 3001. If you
change the backend port, update `frontend/vite.config.ts`. For production, serve
the built frontend and proxy these two paths to the backend under the same origin.
The backend binds to `0.0.0.0` and respects `PORT`.

## Upgrading from the initial version

Run `npm run db:migrate` in `backend` to apply both versioned migrations, check `.env` against the example,
and restart the backend and frontend together. Message acknowledgements and
paginated responses require matching client/server versions. Migration 002 adds
roles, account lifecycle, configurable capacity, and assignment history. Existing
accounts remain agents; existing staff tokens require a fresh login. Provision a
new super admin through the CLI. Duplicate normalized emails must be resolved
before migration; no accounts or messages are silently merged or removed.

Old client-generated `visitorId` values cannot prove ownership and are deliberately
not accepted as credentials. Existing messages remain available to agents. Visitors
receive a new signed session on their first visit after this upgrade; subsequent
refreshes and reconnects recover that session's history.

## Verification

Install dependencies in both packages before running tests. The socket integration
test uses the frontend's actual Socket.IO client.

```sh
cd backend
npm test
npm run test:postgres
```

`npm test` covers chat business rules, authentication, validation, multiple-tab
presence, repository cleanup, and a real HTTP/Socket.IO round trip using in-memory
persistence. `npm run test:postgres` uses the local server from `DATABASE_URL` to
create a randomly named disposable database, applies the schema/migration, tests
real persistence and concurrency, and drops only that database afterward. It
requires permission to create databases and refuses nonlocal servers. It never
runs against the application database.

```sh
cd frontend
npm run typecheck
npm run build
```

## Operations and limits

For a step-by-step Ubuntu EC2 setup with Nginx, HTTPS, PostgreSQL, Redis, and
systemd, see [Deploy to AWS EC2](docs/aws-deployment.md).

- `GET /health` checks whether the process is responding.
- `GET /ready` checks PostgreSQL and Redis; Redis failure returns HTTP 503 and a
  degraded state. Local socket presence and persisted chat can continue while Redis
  reconnects. PostgreSQL failures produce safe errors rather than saved confirmations.
- Agent availability is transient connection state, not the legacy `agents.status`
  column. Closing one tab keeps the agent available if another tab remains connected.
- Redis presence keys use `livechat:presence:<socketId>`, renew every 15 seconds,
  expire after 45 seconds, and are removed on disconnect. No Redis key scans are used.
- This implementation supports one backend process. Multiple backend instances
  require coordinated presence, shared rate limits, a Socket.IO adapter, and suitable
  load balancing before deployment.
- Rate limits are bounded per-process limits. HTTP limits use the direct peer IP;
  proxy trust is intentionally disabled. Configure a trusted reverse proxy and edge
  limits for your hosting environment instead of blindly trusting forwarded headers.
- Limits: 4,000 characters per message, 16 KiB request/socket payloads, 100 rows per
  page, and a 10-second send acknowledgement timeout. Retries are explicit and keep
  the same key while the page remains open. Pending drafts are not persisted on reload.
- History uses deterministic timestamp/ID cursors. Timestamps are ISO 8601 UTC;
  existing timezone-less database values are interpreted as UTC. If an older deployment
  wrote local wall-clock values, normalize them separately before relying on UTC times.
- SQL statements have a 10-second timeout. SIGINT/SIGTERM close socket/HTTP, database,
  and Redis connections with a 10-second shutdown deadline.

## Embedding

Host the frontend under HTTPS and embed the widget URL in an iframe:

```html
<iframe
  title="Support chat"
  src="https://your-support-host/widget"
  style="position:fixed;bottom:0;right:0;border:none;width:360px;height:560px;z-index:9999"
></iframe>
```

The widget's signed visitor token is stored in its origin's local storage. Browser
storage restrictions for embedded content may affect persistence across visits.
