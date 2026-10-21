# HTTP and socket contracts

Agents access only their assigned conversations. Super admins have explicit
oversight across all conversations; visitors access only their own signed
identity's history. Queued conversations expose limited metadata to agents.
See [Priority 1 contracts and setup](agent-ownership.md) for account management,
capacity, acceptance, and lifecycle endpoints.

## Authentication

`POST /api/auth/login` accepts `{ email, password }` and returns
`{ token, agent: { id, name, email, role, is_active, capacity, active_chats, pending_setup } }`. Protected HTTP endpoints require
`Authorization: Bearer <token>`. Errors use
`{ error: { code, message } }` with an appropriate HTTP status.

Agent socket handshakes use `auth: { token, status?: 'online' | 'offline' }`.
Visitor handshakes use `auth: { visitorToken? }`. An invalid supplied credential
rejects the connection rather than downgrading it to an anonymous visitor.
Anonymous connections may create a visitor session through `visitor_join`.

Staff role, active state, setup status, session version, and token expiration are
checked against PostgreSQL on each incoming event. Password resets and account
deactivation increment the session version and disconnect all account sockets.
Expiration also disconnects idle sockets. Legacy unversioned staff tokens require
a fresh login. Rotating the JWT secret invalidates all signed sessions.

## Message representation

Public messages contain `id`, `conversation_id`, `sender_type` (`agent`, `visitor`,
or `system`), `content`, `created_at`, and `client_message_id` (nullable UUID).
Timestamp strings use ISO 8601 UTC with microsecond precision; the backend
preserves PostgreSQL's precision for stable history ordering.

Rows are ordered by `(created_at, id)` ascending. Cursors are message UUIDs: the
database looks up the original timestamp instead of accepting a rounded client
timestamp. Clients merge events, acknowledgements, and history by server ID.

## Acknowledgements

Every request event below accepts a final acknowledgement callback. Success is
`{ ok: true, data }`; failure is `{ ok: false, error: { code, message } }`.
The frontend waits at most 10 seconds. A timeout means the outcome is unknown,
not that persistence failed. A retry reuses the same `clientMessageId`.

Supported request events:

- `visitor_join`: `{}`. Creates a random visitor identity for an anonymous socket,
  or reuses the verified visitor's latest open conversation. Returns
  `{ conversationId, visitorToken }` and emits `conversation_ready` with that data.
  Supplied legacy visitor/conversation IDs are ignored. Rejoining after resolution
  creates a new conversation. Visitor-row locking serializes concurrent joins.
- `message_history`: `{ conversationId, limit?, before?, after? }`. Returns
  `{ messages, hasMore }`; defaults to the latest 50 messages, maximum 100.
  Use `before` for older pages or `after` to drain missed messages in ascending
  order. Only one cursor is accepted, and it must belong to the conversation.
- `send_message`: `{ conversationId, content, clientMessageId }`. Returns the saved
  message. Identity/type are derived from authentication. Empty/oversized content
  is rejected. Resolved conversations reject new sends.
- `agent_status`: `'online' | 'offline'`. Agent-only. Returns `{ status }` and
  synchronizes every live connection for that agent through `agent_status_current`.
- `visitor_presence`: `{ visitorIds: string[] }`. Staff-only snapshot for up to 100
  visitor database UUIDs. Returns `{ onlineVisitorIds: string[] }`; requested IDs
  absent from the result are offline. Used when loading conversations and after
  reconnect. A presence invalidation cancels the in-flight snapshot and fetches
  a new one, preventing stale responses from overwriting the current state.
- `typing`: `{ conversationId, isTyping }`. Requires conversation access; broadcasts
  are throttled to one per 500 ms per socket. Returns `{}`. UI integration is pending.

Server events:

- `new_message`: a saved public message delivered to the conversation's visitors,
  its authorized owner, and super admins. Staff recipients are reauthorized at
  delivery and do not join visitor rooms.
- `conversation_update`: `{}`; tells staff to refresh their scoped lists without
  revealing unrelated conversation IDs.
- `conversation_resolved`: `{ id }`; delivered to authorized recipients after resolution commits.
- `conversation_ready`: `{ conversationId, visitorToken }`.
- `support_availability`: `{ online }`; initial snapshot and connection/status changes.
- `agent_status_current`: `'online' | 'offline'` for the connected agent.
- `presence_changed`: no payload; invalidates visitor presence snapshots.
  `visitor_presence` returns only requested IDs visible to this staff account
  through owned/queued conversations or super-admin oversight. Multiple tabs
  keep a visitor online until the final connection leaves.
- `service_state`: `{ redis }`; reports degraded presence caching.
- `session_expired`: emitted before a socket is disconnected for expiry.
- `request_error`: `{ code, message }`; also used when a request has no callback.

## Persistence and recovery

Message insertion, optional knowledge-base reply, and conversation update share
one PostgreSQL transaction. Broadcast and acknowledgement occur after commit.
The uniqueness constraint scopes retry keys to conversation, sender type, and
verified sender ID. The conversation row lock serializes send/resolve races.
Reusing a key with different content returns `IDEMPOTENCY_CONFLICT`.

After reconnect, the widget joins its authorized room before fetching missed
history; the agent dashboard also fetches missed history. Recovery advances a
separate history cursor, so receiving a newer live event cannot skip older missed
messages. Initial pages and subsequent requests are bounded; older messages can
be loaded explicitly. Recovery drains at most 100 pages per sync; the UI exposes
retry if a larger backlog remains. There is no transactional outbox: reconnect or
manual history reconciliation recovers messages committed before a process failure.

## HTTP pagination

- `GET /api/conversations?limit=50&before=<conversationId>` returns
  `{ conversations, hasMore }`, ordered by `(created_at, id)` descending. Use `view=mine`, `view=queue`, or
  super-admin-only `view=all`.
  Rows include `visitor_identity_id`, the database UUID used for presence lookup,
  alongside the existing public `visitor_id` label.
  Creation-time cursors remain stable when messages arrive. Queue rows for agents
  redact last_message, ip_address, and location; claimed chats require ownership.
- `GET /api/conversations/:id/messages` accepts the same history query fields as
  `message_history` and returns the same page shape.
- `POST /api/conversations/:id/resolve` returns `{ success: true }` after commit.
- `GET /api/quick-replies?limit=50` returns a bounded list for authenticated agents.
- `GET /api/settings` exposes only the widget's welcome/announcement settings.

Common error codes include `INVALID_INPUT`, `INVALID_CURSOR`, `UNAUTHORIZED`,
`FORBIDDEN`, `NOT_FOUND`, `RATE_LIMITED`, `CONVERSATION_RESOLVED`,
`IDEMPOTENCY_CONFLICT`, and `INTERNAL_ERROR`. Internal database diagnostics and
message bodies are never included in public errors.
