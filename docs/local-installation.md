# Clone and run the project on another PC

This guide sets up a new **Windows development PC** using PowerShell. Node.js
runs the backend and frontend directly on Windows; Docker runs local PostgreSQL
and Redis services. You do not need an AWS account for local development.

For hosting on AWS, use [the AWS deployment guide](aws-deployment.md).

## 1. Install the required applications

Use these versions for this setup:

- **Git 2.x**, current stable release: required to clone and update the repo.
  Install [Git for Windows](https://git-scm.com/downloads/win) with command-line
  access enabled.
- **Node.js 24.x**, latest available patch in that major version: the repository
  README identifies Node.js 24 as the verified development runtime. Install it
  from [Node.js downloads](https://nodejs.org/en/download), including npm and the
  option to add Node.js to `PATH`.
- **npm 9 or newer**: use the npm bundled with Node.js 24; a separate installation
  or downgrade is unnecessary. The repository uses npm lockfile format 3.
- **Docker Desktop**, current stable Windows release, using **Linux containers**
  and the **WSL 2 backend**: runs both database services without separate native
  PostgreSQL or Redis installations. This repo does not pin a Docker Desktop
  version. Follow its current
  [Windows system requirements and installation instructions](https://docs.docker.com/desktop/setup/install/windows-install/).
- **WSL 2**, with WSL package version **2.1.5 or newer**, preferably current:
  required for this Docker Desktop setup. Follow
  [Docker's WSL setup instructions](https://docs.docker.com/desktop/features/wsl).
- **PostgreSQL server 17.x**, via the official `postgres:17` Docker image.
- **Redis server 7.4.x**, via the official `redis:7.4` Docker image.
- **A current browser**, such as Microsoft Edge, Chrome, or Firefox.
- **Optional editor:** current stable Visual Studio Code or another editor.
  An editor is useful but is not required to run the app.

PostgreSQL 17 and Redis 7.4 are the selected versions for this guide, **not
established minimum supported versions**. The repository does not declare or
test a database-server compatibility matrix. Docker tags select a version line;
record the actual patch versions when diagnosing issues. The npm `redis` package
version is a client-library version, not the Redis server version.

React, Vite, TypeScript, Tailwind, Express, Socket.IO, bcrypt, and database client
libraries are installed automatically from the package lockfiles. Do not install
them globally. The current lockfiles contain React 18.3.1, TypeScript 5.9.3,
Vite 5.4.21, Tailwind CSS 3.4.19, Express 4.22.3, and Socket.IO 4.8.4; the
lockfiles remain authoritative when the repository changes.

For Windows, use a Windows release supported by the current Docker Desktop
installer, with hardware virtualization enabled. Check Docker's requirements
before installing on an older PC.

### Set up WSL and Docker Desktop

If WSL is not installed, open **PowerShell as Administrator**:

```powershell
wsl --install
```

Restart if prompted, complete the distribution's first-run setup, then:

```powershell
wsl --update
wsl --version
```

Install Docker Desktop using its official installer, enable the WSL 2 engine,
and start Docker Desktop. Wait until its engine is running. Use Linux container
mode. The remaining commands run in ordinary Windows PowerShell, not inside
the WSL Linux terminal.

After installing Git and Node.js, open a **new** terminal and verify:

```powershell
git --version
node --version
npm.cmd --version
docker version
```

Expected: Git 2.x, Node `v24.x.x`, npm 9+, and both Docker **Client** and
**Server** information. A missing Docker Server means its engine is not ready.

This guide uses `npm.cmd` because PowerShell may block the `npm.ps1` shim.
It runs the same npm CLI without changing PowerShell execution policy.

## 2. Clone the repository

Get the repository's clone URL from its Git hosting page. Replace
`YOUR_REPOSITORY_CLONE_URL` below with that URL.

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\Documents\Projects" | Out-Null
Set-Location "$env:USERPROFILE\Documents\Projects"
git clone YOUR_REPOSITORY_CLONE_URL live-chat
Set-Location live-chat
```

For a private repository, authenticate using your Git provider's supported
credential manager or SSH setup. Do not put tokens in the clone URL.

All following relative paths assume this new `live-chat` directory unless a
step says otherwise. Cloning transfers code, not the other PC's databases,
agent accounts, `.env` file, or browser sessions.

## 3. Install the project dependencies

From the repository root:

```powershell
npm.cmd --prefix backend ci
npm.cmd --prefix frontend ci
```

Use both committed package lockfiles. The root `package.json` is not a workspace
installer and does not provide an app startup script.

Stop if either command fails. If npm reports a lockfile mismatch, resolve that
in the source repository rather than deleting lockfiles or introducing Yarn/pnpm.
Do not copy `node_modules` from another PC.

## 4. Start local PostgreSQL and Redis

These instructions create new containers and a persistent PostgreSQL volume.
If you already have a database service on ports 5432 or 6379, use the
existing service or adjust the port mapping and `.env` together.

Pull the official images:

```powershell
docker pull postgres:17
docker pull redis:7.4
docker volume create live-chat-pgdata
```

Prompt for a new PostgreSQL administrator password and start PostgreSQL:

```powershell
$pgAdminPassword = Read-Host "Choose a local PostgreSQL administrator password" -AsSecureString
try {
    $env:POSTGRES_PASSWORD = [System.Net.NetworkCredential]::new("", $pgAdminPassword).Password
    docker run -d --name live-chat-postgres --restart unless-stopped -p 127.0.0.1:5432:5432 -e POSTGRES_PASSWORD -v live-chat-pgdata:/var/lib/postgresql/data postgres:17
} finally {
    Remove-Item Env:\POSTGRES_PASSWORD -ErrorAction SilentlyContinue
    Remove-Variable pgAdminPassword -ErrorAction SilentlyContinue
}
docker run -d --name live-chat-redis --restart unless-stopped -p 127.0.0.1:6379:6379 redis:7.4
```

Save that administrator password in your password manager. The command passes
it through the environment instead of recording it in shell history. Anyone
with local Docker administrative access can inspect container configuration.
This is a dedicated local development setup.

The bindings expose services only on your PC's loopback interface.
Redis holds transient presence records, so it does not need a durable volume
for this app. PostgreSQL data remains in `live-chat-pgdata` across container
stops and restarts.

Check readiness:

```powershell
docker exec live-chat-postgres pg_isready -U postgres
docker exec live-chat-redis redis-cli ping
docker exec live-chat-postgres postgres --version
docker exec live-chat-redis redis-server --version
```

Wait until PostgreSQL reports `accepting connections`; Redis should return
`PONG`. See the
[official PostgreSQL image documentation](https://hub.docker.com/_/postgres)
for initialization and volume behavior. Changing `POSTGRES_PASSWORD` later
does not reset credentials in an already initialized volume.

## 5. Create the application database

Open the container's PostgreSQL console:

```powershell
docker exec -it live-chat-postgres psql -U postgres
```

Run these commands **inside psql**:

```sql
CREATE ROLE livechat LOGIN CREATEDB;
\password livechat
CREATE DATABASE livechat OWNER livechat;
\q
```

The `\password` command prompts for a separate application database password.
Choose a strong password and save it. This development role has `CREATEDB`
because `npm run test:postgres` creates and removes a disposable test database.
Do not use that extra privilege for a production application role.

Initialize the **new empty database** from the repository schema:

```powershell
docker cp .\backend\schema.sql live-chat-postgres:/tmp/live-chat-schema.sql
docker exec live-chat-postgres psql -U livechat -d livechat -v ON_ERROR_STOP=1 -f /tmp/live-chat-schema.sql
```

The official image permits local socket administration inside the container;
the app's TCP connection still uses the database password. No Windows `psql`
installation is needed for this route.

If reusing an existing app database, do not repeat initialization. Back it up
and apply `npm.cmd --prefix backend run db:migrate` after configuring `.env`.
The current migration does not create a fresh database's base tables.

## 6. Create the backend environment file

For a fresh clone:

```powershell
Copy-Item .\backend\.env.example .\backend\.env
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
notepad .\backend\.env
```

Do not overwrite an existing `.env`. Replace its placeholder values:

```dotenv
PORT=3001
DATABASE_URL=postgresql://livechat:YOUR_APPLICATION_DATABASE_PASSWORD@127.0.0.1:5432/livechat
REDIS_URL=redis://127.0.0.1:6379
JWT_SECRET=YOUR_GENERATED_RANDOM_SECRET
NODE_ENV=development
ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
```

Use the `livechat` role password from step 5, not the administrator password.
URL-encode reserved characters in that password before placing it in
`DATABASE_URL`. For example, `@` becomes `%40`, `#` becomes `%23`, and `%` becomes
`%25`. A random hexadecimal password avoids this encoding step.

The generated JWT secret must be at least 32 characters; use a fresh secret for
this installation. Keep `.env` private; Git ignores it. No frontend `.env` or
`VITE_API_URL` is needed: Vite forwards `/api` and `/socket.io` to port 3001.

## 7. Create an agent login

There are no default login credentials or public registration page.
Generate a bcrypt hash from a password prompt:

```powershell
Push-Location .\backend
$agentPassword = Read-Host "Choose the agent login password" -AsSecureString
try {
    [System.Net.NetworkCredential]::new("", $agentPassword).Password | node -e "const fs=require('node:fs'); const bcrypt=require('bcryptjs'); const password=fs.readFileSync(0,'utf8').replace(/\r?\n$/, ''); console.log(bcrypt.hashSync(password,12));"
} finally {
    Remove-Variable agentPassword -ErrorAction SilentlyContinue
    Pop-Location
}
```

For this Windows PowerShell pipeline, use an ASCII password or passphrase:
Windows PowerShell 5.1's native-process input encoding may alter non-ASCII text.
The command removes only the line ending added by the PowerShell pipeline.
Copy the resulting bcrypt hash, then:

```powershell
docker exec -it live-chat-postgres psql -U livechat -d livechat
```

Inside `psql`:

```sql
\prompt 'Agent name: ' agent_name
\prompt 'Agent email: ' agent_email
\prompt 'Paste bcrypt hash: ' agent_hash
INSERT INTO agents (name, email, password_hash)
VALUES (:'agent_name', :'agent_email', :'agent_hash');
\q
```

Sign in using this email and the original password, not the hash. Email matching
is currently case-sensitive. Every agent can access the shared inbox.

## 8. Run backend and frontend

Open two PowerShell terminals in the repository root.

**Terminal 1 — backend:**

```powershell
npm.cmd --prefix backend run dev
```

**Terminal 2 — frontend:**

```powershell
npm.cmd --prefix frontend run dev -- --strictPort
```

Keep both running. `--strictPort` prevents Vite from silently selecting a
different port that does not match the allowed origins.

Open:

- Agent login: <http://localhost:5173/login>
- Agent dashboard: <http://localhost:5173/dashboard>
- Visitor widget: <http://localhost:5173/widget>

Check backend health from a third PowerShell terminal:

```powershell
Invoke-RestMethod http://localhost:3001/health
Invoke-RestMethod http://localhost:3001/ready
```

Expected: `status: ok` from health and `status: ready`, `database: true`,
`redis: true` from readiness. Open the widget in an incognito window, send a
message, reply from the dashboard, and refresh to confirm history recovery.

These URLs are for the new PC itself. Do not expose development database ports
or the Vite server publicly; use the AWS guide for a hosted deployment.

## 9. Run the repository checks

From the repo root, with both packages installed:

```powershell
npm.cmd --prefix backend test
npm.cmd --prefix backend run test:postgres
npm.cmd --prefix frontend run typecheck
npm.cmd --prefix frontend run build
```

- Backend tests need the frontend's Socket.IO client package.
- PostgreSQL integration tests use the local `DATABASE_URL`, create a randomly
  named database, and remove it afterward. Use the dedicated local setup above,
  not a production/shared database configuration.
- Frontend build output is `frontend/dist`.
- No lint or formatting script is currently defined.

## 10. Stop and resume work

Stop the two development servers with **Ctrl+C**. To stop the services:

```powershell
docker stop live-chat-postgres live-chat-redis
```

Next time, start Docker Desktop and resume:

```powershell
docker start live-chat-postgres live-chat-redis
```

Then repeat step 8. Do not rerun `docker run`, create the database again, or
recreate the agent on each startup. Do not delete `live-chat-pgdata` unless you
intend to delete this PC's saved chats and accounts.

For source updates, first save or commit local work, then:

```powershell
git pull --ff-only
npm.cmd --prefix backend ci
npm.cmd --prefix frontend ci
```

Stop development servers before replacing dependencies. Review the update's
migration instructions, back up local data before schema changes, and run the
checks again. Keep your existing local `.env`.

## Troubleshooting

- **`git`, `node`, or npm is not found:** reopen the terminal after installing,
  and verify the installer added the application to `PATH`.
- **`npm.ps1` cannot be loaded:** use `npm.cmd` as shown; no execution-policy
  change is necessary.
- **Docker cannot connect:** start Docker Desktop, verify WSL 2 and Linux
  container mode, and run `docker version` again.
- **Container name already exists:** use `docker ps -a` and resume the existing
  container with `docker start`; do not delete a database just to reuse its name.
- **Database port already in use:** avoid starting a second PostgreSQL instance
  on 5432. If mapping the new container to `127.0.0.1:5433:5432`, use port 5433
  in `DATABASE_URL`.
- **Database password authentication fails:** confirm the role and password
  created in step 5 and URL encoding. An existing Docker volume retains its old
  credentials even if a container is created with a new initialization password.
- **Backend says a required variable is missing:** check `backend/.env`, not
  a root `.env`, and restart the backend after editing it.
- **Missing tables:** initialize the new database with `backend/schema.sql`.
  For an existing older schema missing `client_message_id`, apply `db:migrate`.
- **`/ready` is degraded:** run `docker exec live-chat-redis redis-cli ping`
  and check `docker logs live-chat-redis`.
- **Database test cannot create a database:** use the dedicated local development
  role with `CREATEDB`; do not grant it to a production role.
- **Port 3001 or 5173 is occupied:** stop the conflicting development process.
  If changing ports, keep `PORT`, `frontend/vite.config.ts`, and
  `ALLOWED_ORIGINS` aligned.
- **Login fails:** create an agent in this PC's database; accounts are not part
  of the Git clone.

If Docker is unavailable, native PostgreSQL 17 and Redis 7.4 can supply the same
connection URLs. Use `psql` to run the schema and create credentials; on Windows,
follow [Redis's supported Windows installation options](https://redis.io/docs/latest/operate/oss_and_stack/install/install-redis/install-redis-on-windows/).
Do not install an obsolete unofficial Windows Redis executable just to match a
tutorial. The numbered commands above assume Docker, so adapt service management
and `docker exec` commands if choosing native installations.

The dependency versions and scripts were checked against this repository.
A fresh-PC installation of this guide has not been executed.
