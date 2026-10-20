# Deploy this Live Chat app to AWS EC2

This guide deploys the current repository to **one Ubuntu 24.04 LTS EC2 instance**.
It is intended for the practice/test app and a small demonstration deployment.
It uses Node.js 24, Nginx, PostgreSQL, Redis, and systemd.

The instructions were prepared against this repository on October 20, 2026.
They have not been executed on an AWS account.

## What you will deploy

```text
Browser -> https://chat.example.com -> Nginx (80/443)
                                        |
                                        +-- frontend/dist (React app)
                                        +-- /api/* -> Node.js :3001
                                        +-- /socket.io/* -> Node.js :3001
                                                             |
                                                             +-- PostgreSQL :5432
                                                             +-- Redis :6379
```

Nginx serves the built frontend and forwards API and Socket.IO traffic to the
backend. PostgreSQL stores messages; Redis supports transient presence records.
Only Nginx is public. Port **3001** is the backend's internal port; visitors do
not need to connect to it directly.

This matches the repository:

- `backend/server.js` starts the server with `npm start`.
- `backend/.env.example` lists the required backend settings.
- `backend/schema.sql` initializes an empty database.
- `backend/scripts/migrate.js` applies the existing additive migration.
- `frontend/src/lib/api.ts` uses relative API paths.
- `frontend/src/features/chat/useChatSession.ts` connects to the same origin.
- `frontend/vite.config.ts` provides a development proxy only. Nginx replaces it
  in this deployment.
- `frontend/src/App.tsx` defines `/login`, `/dashboard`, and `/widget`.

**Current limitations:** use exactly one backend process. Do not enable PM2
cluster mode or multiple EC2 application instances with this code. Agent inbox
access is shared across all agents; exclusive assignment is not implemented.
See [HTTP and socket contracts](realtime.md) for the current behavior.

## 1. Prepare your AWS account and domain

You need:

- An AWS account with permission to create EC2 instances, security groups, and
  an Elastic IP.
- A domain or subdomain you control, such as `chat.example.com`.
- Windows OpenSSH tools (`ssh` and `scp`) and `tar` on your development computer.
- Your repository at `C:\Users\Jhon\Documents\everlounge\live-chat`.

Replace these examples throughout:

- `YOUR_ELASTIC_IP`: your instance's public Elastic IP.
- `chat.example.com`: your actual support subdomain.
- `C:\Users\Jhon\Downloads\live-chat-key.pem`: your private SSH key location.

The full guide assumes a domain and HTTPS. If you do not yet have a domain, you
can complete installation and test the backend over SSH, but finish DNS and TLS
before using browser login or sharing the app.

EC2, EBS storage, public IPv4 addresses, snapshots, and data transfer can incur
charges. Check your account's eligibility and create an AWS Budget alert before
launching resources; do not assume this setup is free.
[AWS EC2 getting started](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/EC2_GetStarted.html)
describes launch prerequisites and billing considerations.

## 2. Launch the EC2 instance

In the AWS console:

1. Open **EC2**, select your intended Region, and choose **Launch instance**.
2. Name it `live-chat-test`.
3. Choose the official Canonical **Ubuntu Server 24.04 LTS**, **64-bit x86** AMI.
4. For this all-in-one test server, start with a `t3.small` or another x86 instance
   with at least 2 GiB RAM. This is a starting estimate, not a measured capacity.
5. Create an SSH key pair and download the `.pem` file. Keep it outside the repo.
6. Use a public subnet with a route to an Internet Gateway.
7. Configure an encrypted gp3 EBS root volume, for example 20 GiB.
8. Create a security group with these inbound rules:
   - TCP **22**: your public IP only, using a `/32` source.
   - TCP **80**: `0.0.0.0/0`.
   - TCP **443**: `0.0.0.0/0`.
9. Leave ports **3001**, **5173**, **5432**, and **6379** closed to inbound internet
   traffic. Outbound access is needed for package downloads and certificate setup.
10. Launch and wait for the instance status checks to pass.

These commands assume IPv4. If you deliberately enable IPv6, configure its
network rules and DNS separately. Do not publish an AAAA record for an address
that cannot serve the app.

For details on rule sources, see
[AWS security group rules](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/security-group-rules-reference.html).

## 3. Assign a stable IP and configure DNS

1. In **EC2 > Elastic IP addresses**, allocate an Elastic IP.
2. Associate it with the new EC2 instance.
3. At your DNS provider, create an **A record**:
   - Name: `chat` if your domain is `example.com`.
   - Value: your Elastic IP.
4. Use direct DNS resolution to EC2 for this guide; additional CDN/proxy layers
   require separate trusted-proxy configuration.

An Elastic IP remains stable across instance stops and starts. Allocated Elastic
IPs incur charges even when idle.
[AWS Elastic IP documentation](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/elastic-ip-addresses-eip.html)
explains allocation and billing.

**On your Windows computer, in PowerShell:**

```powershell
Resolve-DnsName chat.example.com
ssh -i "C:\Users\Jhon\Downloads\live-chat-key.pem" ubuntu@YOUR_ELASTIC_IP
```

Verify the server host key before accepting the first SSH connection. The Ubuntu
AMI login user is `ubuntu`.

**From the next step onward, `bash` blocks run inside this SSH session.**
Blocks labeled `powershell` run on your Windows computer.

## 4. Install server packages and Node.js

**On EC2:**

```bash
sudo apt update
sudo apt upgrade -y
sudo apt install -y nginx postgresql postgresql-contrib redis-server \
  curl ca-certificates xz-utils openssl snapd
sudo systemctl enable --now nginx postgresql redis-server
```

Install the latest available Node.js 24 build for Linux x64 from the official
distribution. The repository README identifies Node.js 24 as its verified major
version. This block downloads the checksum list, verifies the archive, and
installs into `/opt/node24` on this fresh server:

```bash
(
  set -eu
  node_download_dir="$(mktemp -d)"
  cd "$node_download_dir"
  curl -fsSLO https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt
  node_archive="$(awk '$2 ~ /^node-v24\..*-linux-x64\.tar\.xz$/ {print $2}' SHASUMS256.txt)"
  test -n "$node_archive"
  node_version="${node_archive#node-}"
  node_version="${node_version%-linux-x64.tar.xz}"
  curl -fsSLO "https://nodejs.org/dist/$node_version/$node_archive"
  awk -v file="$node_archive" '$2 == file' SHASUMS256.txt | sha256sum --check -
  sudo mkdir -p /opt/node24
  sudo tar -xJf "$node_archive" -C /opt/node24 --strip-components=1
  sudo ln -s /opt/node24/bin/node /usr/local/bin/node
  sudo ln -s /opt/node24/bin/npm /usr/local/bin/npm
  sudo ln -s /opt/node24/bin/npx /usr/local/bin/npx
)
node --version
npm --version
```

Stop if any download or checksum check fails. Expected Node output begins with
`v24.`. On an existing server, inspect existing installations before changing
Node paths; these steps assume the paths do not already exist.
Official distributions are available from [Node.js downloads](https://nodejs.org/en/download).

## 5. Upload the project from Windows

This method uploads your current working files, including uncommitted code.
Review them before packaging. It excludes `.env` files, dependency directories,
and generated builds. Do not upload your Windows `node_modules`.

**On Windows, open a separate PowerShell terminal:**

```powershell
Set-Location "C:\Users\Jhon\Documents\everlounge\live-chat"
tar -czf "$env:TEMP\live-chat-upload.tar.gz" --exclude=node_modules --exclude=dist --exclude='.env' --exclude='.env.*' backend frontend README.md FEATURE.md docs
tar -tzf "$env:TEMP\live-chat-upload.tar.gz"
scp -i "C:\Users\Jhon\Downloads\live-chat-key.pem" "$env:TEMP\live-chat-upload.tar.gz" ubuntu@YOUR_ELASTIC_IP:/home/ubuntu/
```

Check each command succeeds before proceeding. Review the archive listing before
the `scp` command; it must not contain credentials or `.env` files. The example
environment file is also excluded; the server environment is created in step 7.

**On EC2:**

```bash
sudo adduser --system --group --no-create-home livechat
sudo install -d -o ubuntu -g ubuntu -m 755 /srv/live-chat
tar -xzf /home/ubuntu/live-chat-upload.tar.gz -C /srv/live-chat
cd /srv/live-chat/backend
npm ci
cd /srv/live-chat/frontend
npm ci
```

Use `npm ci` because both packages have committed `package-lock.json` files.
There is no root workspace install/build command; install each package
separately. If `npm ci` reports a lockfile mismatch, fix and commit the lockfile
locally instead of improvising dependency changes on the server.

## 6. Create PostgreSQL storage and check Redis

Use a new, dedicated database and role. Do not reuse the PostgreSQL superuser as
the application user.

```bash
sudo -u postgres createuser --pwprompt livechat
sudo -u postgres createdb --owner=livechat livechat
sudo -u postgres psql -v ON_ERROR_STOP=1 -d livechat \
  -c 'CREATE EXTENSION IF NOT EXISTS "uuid-ossp";'
psql -h 127.0.0.1 -U livechat -d livechat -W -v ON_ERROR_STOP=1 \
  -f /srv/live-chat/backend/schema.sql
```

The first command prompts for the database role's password. Generate a strong
password with a password manager and save it securely. A random hexadecimal
password from `openssl rand -hex 32` is convenient because it does not need URL
encoding. The final command prompts for that same database password.

Run `schema.sql` only for a **new empty database**. For an existing installation,
back up first and use `npm run db:migrate` from `backend` after configuring its
environment. The current migration adds message idempotency and pagination
indexes; it does not create the initial tables.

Verify local services:

```bash
sudo -u postgres psql -Atc "SHOW listen_addresses;"
sudo ss -lntp | grep -E ':(5432|6379)\b'
redis-cli ping
```

Expected: PostgreSQL listens on localhost, Redis binds only to loopback, and
Redis replies `PONG`. If Redis is listening publicly, edit
`/etc/redis/redis.conf` to use `bind 127.0.0.1 ::1` and `protected-mode yes`,
then restart `redis-server`. Keep PostgreSQL restricted to localhost too.

This guide uses Redis without a password on a dedicated host with loopback-only
access. PostgreSQL and Redis are not exposed through Nginx or the EC2 security
group. Moving them to another machine requires a separate authenticated,
TLS-protected setup.

## 7. Configure the backend environment

Generate a separate JWT signing secret:

```bash
openssl rand -hex 32
umask 077
touch /srv/live-chat/backend/.env
nano /srv/live-chat/backend/.env
```

Enter this configuration, replacing all uppercase placeholder values:

```dotenv
NODE_ENV=production
PORT=3001
DATABASE_URL=postgresql://livechat:YOUR_DATABASE_PASSWORD@127.0.0.1:5432/livechat
REDIS_URL=redis://127.0.0.1:6379
JWT_SECRET=YOUR_GENERATED_JWT_SECRET
ALLOWED_ORIGINS=https://chat.example.com
```

- `DATABASE_URL` must use the password from step 6. URL-encode reserved
  characters if you chose a password containing characters such as `@`, `:`,
  `/`, `#`, or `%`.
- `JWT_SECRET` must be a unique random secret of at least 32 characters.
  Preserve it across normal deployments so sessions remain valid.
- `ALLOWED_ORIGINS` must match the browser origin exactly, without a trailing
  slash or path. Multiple origins are comma-separated.
- Do not copy your local development `.env` to AWS. Create server-specific values.
- No `VITE_API_URL` is required by this frontend. The public domain serves both
  API and socket paths.

Restrict the file while allowing the service account to read it:

```bash
sudo chown ubuntu:livechat /srv/live-chat/backend/.env
chmod 640 /srv/live-chat/backend/.env
umask 022
```

The backend loads this exact `.env` path through `dotenv`. Do not publish it in
the frontend's static directory.

## 8. Create your first agent account

There is no default account or registration page. First generate a bcrypt hash
without placing the plaintext password in shell history or command arguments:

```bash
cd /srv/live-chat/backend
read -rsp 'New agent password: ' agent_password
printf '\n'
printf '%s' "$agent_password" | node -e \
  "const fs = require('node:fs'); const bcrypt = require('bcryptjs'); console.log(bcrypt.hashSync(fs.readFileSync(0, 'utf8'), 12));"
unset agent_password
```

Save the resulting bcrypt hash for the next prompt. Then open PostgreSQL:

```bash
psql -h 127.0.0.1 -U livechat -d livechat -W
```

Inside `psql`, run:

```sql
\prompt 'Agent name: ' agent_name
\prompt 'Agent email: ' agent_email
\prompt 'Paste bcrypt hash: ' agent_hash
INSERT INTO agents (name, email, password_hash)
VALUES (:'agent_name', :'agent_email', :'agent_hash');
\q
```

Use the email exactly as entered when logging in; the current login query does
not normalize email case. All agents can access the shared inbox. An account
created here is not a separate super-admin role.

## 9. Verify the packages and build the frontend

Both packages must be installed before backend socket tests run, because those
tests import the frontend Socket.IO client.

```bash
cd /srv/live-chat/backend
npm test
cd /srv/live-chat/frontend
npm run typecheck
npm run build
```

Stop and resolve failures before proceeding. The build output is
`/srv/live-chat/frontend/dist`.

Do not run `npm run test:postgres` against this deployed database configuration.
That script is intended for a development PostgreSQL server where its test role
can create disposable databases. Run it locally with your isolated test setup.
Neither package currently provides a lint or formatting script.

Publish only the frontend build:

```bash
sudo install -d -m 755 /var/www/live-chat
sudo cp -a /srv/live-chat/frontend/dist/. /var/www/live-chat/
sudo chown -R root:root /var/www/live-chat
sudo find /var/www/live-chat -type d -exec chmod 755 {} \;
sudo find /var/www/live-chat -type f -exec chmod 644 {} \;
```

Do not use `npm run dev` or `vite preview` as the public production web server.

## 10. Run the backend with systemd

Create a service:

```bash
sudo nano /etc/systemd/system/live-chat.service
```

Paste:

```ini
[Unit]
Description=Live Chat API and Socket.IO server
Wants=network-online.target
After=network-online.target postgresql.service redis-server.service

[Service]
Type=simple
User=livechat
Group=livechat
WorkingDirectory=/srv/live-chat/backend
Environment=NODE_ENV=production
Environment=PATH=/usr/local/bin:/usr/bin:/bin
ExecStart=/usr/local/bin/node /srv/live-chat/backend/server.js
Restart=on-failure
RestartSec=5
TimeoutStopSec=15
KillSignal=SIGTERM
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
UMask=0077

[Install]
WantedBy=multi-user.target
```

Start and inspect it:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now live-chat
sudo systemctl status live-chat --no-pager
curl --fail-with-body http://127.0.0.1:3001/health
curl --fail-with-body http://127.0.0.1:3001/ready
```

Expected: `/health` returns `{"status":"ok"}` and `/ready` returns HTTP 200 with
database and Redis readiness. Redis may take a moment to connect after startup.
If readiness remains unsuccessful, inspect:

```bash
sudo journalctl -u live-chat -n 100 --no-pager
```

The source currently binds Node to `0.0.0.0`. The EC2 security group must keep
port 3001 inaccessible from the internet. Nginx connects through loopback.

## 11. Configure Nginx for React, API requests, and WebSockets

Create:

```bash
sudo nano /etc/nginx/sites-available/live-chat
```

Paste the configuration below, changing `chat.example.com`:

```nginx
# Ubuntu includes sites-enabled files within the http context.
map $http_upgrade $livechat_connection_upgrade {
    default upgrade;
    ''      close;
}

limit_req_zone $binary_remote_addr zone=livechat_api:10m rate=5r/s;
limit_req_zone $binary_remote_addr zone=livechat_login:10m rate=5r/m;

server {
    listen 80;
    server_name chat.example.com;
    root /var/www/live-chat;
    index index.html;
    client_max_body_size 16k;
    limit_req_status 429;

    location = /api/auth/login {
        limit_req zone=livechat_login burst=5 nodelay;
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /api/ {
        limit_req zone=livechat_api burst=20 nodelay;
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /socket.io/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $livechat_connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 75s;
        proxy_send_timeout 75s;
        proxy_buffering off;
    }

    # Readiness stays available over SSH, not as a public route.
    location = /health { return 404; }
    location = /ready { return 404; }

    location /assets/ {
        try_files $uri =404;
    }

    location / {
        try_files $uri $uri/ /index.html;
        add_header Cache-Control "no-cache";
    }
}
```

The `proxy_pass` values intentionally have no trailing `/`, preserving `/api/`
and `/socket.io/` in upstream requests. The React fallback allows direct visits
to `/login`, `/dashboard`, and `/widget`.

WebSocket upgrade headers and a timeout longer than the heartbeat interval plus
timeout are required for reliable connections.
See [Socket.IO reverse-proxy configuration](https://socket.io/docs/v4/reverse-proxy/).

Enable and validate:

```bash
sudo ln -s /etc/nginx/sites-available/live-chat /etc/nginx/sites-enabled/live-chat
sudo nginx -t
sudo systemctl reload nginx
curl -I -H 'Host: chat.example.com' http://127.0.0.1/login
```

On this fresh server, the packaged default Nginx site may remain enabled; the
matching `server_name` routes your domain to this app. Access the configured
domain rather than expecting the IP address to show the app.

### Important proxy behavior in this repository

The backend currently reads `req.ip` and `socket.handshake.address` and does not
trust forwarded headers. With Nginx, those values identify the local proxy.
Consequently:

- The 300 HTTP requests/minute and 20 login attempts/15 minutes limits are
  shared across users reaching this backend through Nginx.
- The 60 socket handshakes/minute limit is also shared.
- Stored visitor IPs show the proxy address, not the visitor's public address.
- Nginx's per-IP API limits provide another limit layer, but do not change those
  backend limits or fix stored visitor addresses.

This is a material limitation for a busy deployment. Before serving larger
traffic, implement and test narrowly scoped proxy trust for both HTTP and socket
identity, keeping port 3001 private. Do not simply trust arbitrary
`X-Forwarded-For` values. Nginx rate-limit errors may also appear as a generic
request failure because the current frontend expects JSON API errors.

## 12. Enable HTTPS

Confirm the domain resolves to the Elastic IP and inbound port 80 is reachable.
Do not attempt browser login while setup is still HTTP-only.

```bash
sudo snap install --classic certbot
sudo /snap/bin/certbot --nginx -d chat.example.com --redirect
sudo nginx -t
sudo /snap/bin/certbot renew --dry-run
```

Follow the email and terms prompts. Certbot adds the certificate configuration
and HTTP-to-HTTPS redirect. The snap includes automatic renewal; verify the
renewal dry run succeeds.
[Certbot's Nginx instructions](https://certbot.eff.org/instructions?ws=nginx&os=snap)
describe installation and renewal.

Ensure `backend/.env` still contains:

```dotenv
ALLOWED_ORIGINS=https://chat.example.com
```

If you changed the environment, restart:

```bash
sudo systemctl restart live-chat
```

Keep port 80 available for HTTP redirects and certificate validation.

## 13. Test the deployed app

**On EC2:**

```bash
curl --fail-with-body http://127.0.0.1:3001/ready
curl -I https://chat.example.com/login
curl --fail-with-body https://chat.example.com/api/settings
curl --fail-with-body 'https://chat.example.com/socket.io/?EIO=4&transport=polling'
```

The last request should return an Engine.IO handshake beginning with `0` and a
JSON payload. It checks the polling route, not full message delivery.

**In your browser:**

1. Visit `https://chat.example.com/login` and sign in with your agent account.
2. Open `https://chat.example.com/widget` in an incognito window so it has a
   separate visitor session.
3. Confirm agent availability and visitor presence update.
4. Send a visitor message and reply from the agent dashboard.
5. Refresh both windows and confirm saved history returns.
6. Open two visitor tabs in the same visitor session. Close one and confirm the
   remaining tab keeps that visitor online.
7. In browser developer tools, check the Network panel for a successful
   `/socket.io/` WebSocket upgrade (HTTP 101).
8. During this test, restart the backend and confirm reconnection/history recovery:

   ```bash
   sudo systemctl restart live-chat
   ```

9. Verify an unauthenticated request to `/api/conversations` returns HTTP 401:

   ```bash
   curl -i https://chat.example.com/api/conversations
   ```

If the configured reconnect attempts are exhausted, use the UI retry action.
These checks are steps for you to execute, not claims of completed AWS tests.

## 14. Back up and deploy later updates

### Back up the database

Before updating, create a PostgreSQL custom-format backup:

```bash
mkdir -p /home/ubuntu/live-chat-backups
chmod 700 /home/ubuntu/live-chat-backups
umask 077
pg_dump -h 127.0.0.1 -U livechat -d livechat -W -Fc \
  -f "/home/ubuntu/live-chat-backups/livechat-$(date -u +%Y%m%dT%H%M%SZ).dump"
umask 022
```

Check the exit status and inspect the archive with `pg_restore --list FILE.dump`.
Keep encrypted copies off the instance, for example in a private S3 bucket with
restricted IAM access, encryption, and an explicit retention policy. Backups on
the same root disk do not protect against instance or volume loss. Preserve
`backend/.env` separately in secure secret storage.

Test recovery into a separate empty database before relying on backups:

```bash
sudo -u postgres createdb --owner=livechat livechat_restore_check
pg_restore -h 127.0.0.1 -U livechat -d livechat_restore_check -W \
  --no-owner --no-acl --exit-on-error /path/to/your-backup.dump
psql -h 127.0.0.1 -U livechat -d livechat_restore_check -W \
  -c 'SELECT count(*) FROM messages;'
```

Use a fresh recovery database name for subsequent drills. Never point recovery
commands at the running application database.

### Update the app during a maintenance window

1. Run local tests and build checks. Package and upload the new source as in
   step 5; the archive must still exclude `.env`.
2. Back up PostgreSQL and securely preserve the server `.env`.
3. Save the currently running source and static files:

   ```bash
   release_stamp="$(date -u +%Y%m%dT%H%M%SZ)"
   tar --exclude=node_modules --exclude='.env' -czf \
     "/home/ubuntu/live-chat-backups/source-$release_stamp.tar.gz" \
     -C /srv/live-chat .
   sudo tar -czf "/home/ubuntu/live-chat-backups/web-$release_stamp.tar.gz" \
     -C /var/www/live-chat .
   ```

4. Stop the backend before replacing dependencies:

   ```bash
   sudo systemctl stop live-chat
   tar -xzf /home/ubuntu/live-chat-upload.tar.gz -C /srv/live-chat
   cd /srv/live-chat/backend
   npm ci
   cd /srv/live-chat/frontend
   npm ci
   cd /srv/live-chat/backend
   npm test
   cd /srv/live-chat/frontend
   npm run typecheck
   npm run build
   ```

5. Inspect the release's migration requirements. For this repository's existing
   additive migration, run:

   ```bash
   cd /srv/live-chat/backend
   npm run db:migrate
   ```

6. Publish the new build using step 9's copy and permission commands, then:

   ```bash
   sudo systemctl start live-chat
   curl --fail-with-body http://127.0.0.1:3001/ready
   ```

7. Repeat the browser messaging checks and ask already-open clients to refresh
   so frontend/backend versions match.

Stop on any failed command. This simple update method has downtime and retains
files removed from later releases; review and remove obsolete files explicitly
or use a fresh release directory for larger updates. Old hashed frontend assets
may remain to support clients that were already open.

For rollback, stop the backend, restore the saved source and static archives,
reinstall the restored lockfiles with `npm ci`, and retain the original `.env`.
Restart only after verifying schema compatibility and readiness. Code rollback
does not undo database migrations; do not restore an old database over newer
messages as a routine rollback.

## 15. Troubleshooting and ongoing operation

- **SSH times out:** check the Elastic IP, instance health, public subnet route,
  and port 22 source IP. Update the source rule if your home/office IP changed.
- **Permission denied (publickey):** use the matching `.pem` and user `ubuntu`.
  If Windows OpenSSH rejects key permissions, restrict the key file's Security
  permissions to your Windows account rather than making it broadly readable.
- **Nginx 502:** check `systemctl status live-chat`, backend logs, and local
  `/health`. Make sure Nginx's upstream port matches `PORT`.
- **Page refresh returns 404:** check the `try_files ... /index.html` fallback
  and that `/var/www/live-chat/index.html` exists.
- **API receives HTML:** verify the `/api/` Nginx block is active and preserves
  the path. Vite's development proxy does not apply to built files.
- **Socket connection fails:** verify the exact HTTPS origin, upgrade headers,
  `/socket.io/` path, and backend status. Repeated upgrades disconnecting near
  one minute can indicate an insufficient proxy timeout.
- **HTTP 429 or repeated login failures:** check both Nginx limits and the
  backend's shared proxy-IP limits described in step 11.
- **`/ready` returns 503:** inspect PostgreSQL and Redis services. A Redis
  outage can leave durable chat working while presence caching is degraded.
- **Missing `client_message_id`:** apply `npm run db:migrate` against the
  intended existing database, then restart.
- **Certificate issuance fails:** check DNS, public port 80, conflicting AAAA
  records, and any extra DNS proxy layer.
- **Instance runs out of memory or disk:** inspect `free -h`, `df -h`, journal
  size, and package/build output. Resize or move builds off the instance.

Useful inspection commands:

```bash
sudo systemctl status live-chat nginx postgresql redis-server --no-pager
sudo journalctl -u live-chat -n 100 --no-pager
sudo tail -n 100 /var/log/nginx/error.log
sudo nginx -t
df -h
free -h
```

Monitor readiness, disk capacity, certificate renewal, and failed backup jobs.
Schedule OS/security updates and backup restore drills. A single EC2 instance
is a single point of failure; its locally hosted database is not highly
available. Review EBS deletion settings before terminating an instance.

For a later production design, evaluate RDS PostgreSQL and managed Redis with
private networking, authenticated connections, verified TLS certificates,
monitoring, and managed backups. That is a separate deployment design: the
current repository does not yet coordinate multiple backend processes.

## Completion checklist

- [ ] DNS points to the correct Elastic IP.
- [ ] Only SSH from your IP and public HTTP/HTTPS are allowed inbound.
- [ ] PostgreSQL and Redis listen only locally.
- [ ] Dedicated database credentials and a fresh JWT secret are configured.
- [ ] Schema is initialized and an agent account exists.
- [ ] `npm test`, `npm run typecheck`, and `npm run build` pass.
- [ ] systemd starts the backend automatically.
- [ ] Local readiness returns HTTP 200.
- [ ] HTTPS works and the certificate renewal dry run succeeds.
- [ ] Agent/visitor messaging, refresh recovery, and presence work in browsers.
- [ ] Backups exist outside the EC2 instance and a recovery drill succeeds.
