# HTTP and socket contracts

The application has one shared agent inbox. Every authenticated, existing agent
can access all conversations; there are no tenants or assignment restrictions.
Visitors may access only conversations owned by the visitor ID in their signed
credential. IDs or sender roles supplied in event payloads grant no access.

## Authentication

`POST /api/auth/login` accepts `{ email, password }` and returns
`{ token, agent: { id, name, email } }`. Protected HTTP endpoints require
`Authorization: Bearer <token>`. Errors use
`{ error: { code, message } }` with an appropriate HTTP status.

Agent socket handshakes use `auth: { token, status?: 'online' | 'offline' }`.
Visitor handshakes use `auth: { visitorToken? }`. An invalid supplied credential
rejects the connection rather than downgrading it to an anonymous visitor.
Anonymous connections may create a visitor session through `visitor_join`.

Agent account existence and token expiration are checked on each incoming event.
Expiration also disconnects idle authenticated sockets. Tokens currently have no
individual revocation list; deleting an agent blocks its next operation, and
rotating the JWT secret invalidates all sessions on subsequent verification.

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
- `visitor_presence`: `{ visitorIds: string[] }`. Agent-only snapshot for up to 100
  visitor database UUIDs. Returns `{ onlineVisitorIds: string[] }`; requested IDs
  absent from the result are offline. Used when loading conversations and after
  reconnect. The dashboard applies live transitions received during a snapshot
  ahead of that snapshot, preventing stale online/offline indicators.
- `typing`: `{ conversationId, isTyping }`. Requires conversation access; broadcasts
  are throttled to one per 500 ms per socket. Returns `{}`. UI integration is pending.

Server events:

- `new_message`: a saved public message, delivered to the conversation's visitors
  and authenticated agents. Socket.IO's room union avoids duplicate delivery when
  a socket belongs to more than one target room.
- `conversation_update`: `{ conversationId }`; tells agents to refresh the list.
- `conversation_resolved`: `{ id }`; delivered after resolution commits.
- `conversation_ready`: `{ conversationId, visitorToken }`.
- `support_availability`: `{ online }`; initial snapshot and connection/status changes.
- `agent_status_current`: `'online' | 'offline'` for the connected agent.
- `visitor_online` / `visitor_offline`: `{ visitorId }` to agents. Offline is emitted
  only when the visitor's last socket disconnects. IDs are database UUIDs matching
  `visitor_identity_id` in agent conversation responses, not the public `visitor_id`
  label. Visitors are online once joined, even if their widget is minimized. Abrupt
  network loss is detected by Socket.IO heartbeat timeout. Redis leases continue
  to renew/expire as documented in the README; the live snapshot uses this backend's
  active sockets and remains available if the Redis cache is degraded.
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
  `{ conversations, hasMore }`, ordered by `(updated_at, id)` descending.
  Rows include `visitor_identity_id`, the database UUID used for presence lookup,
  alongside the existing public `visitor_id` label.
  Active conversations can move between pages as new messages arrive; the UI
  deduplicates pages and refreshes the newest page on updates.
- `GET /api/conversations/:id/messages` accepts the same history query fields as
  `message_history` and returns the same page shape.
- `POST /api/conversations/:id/resolve` returns `{ success: true }` after commit.
- `GET /api/quick-replies?limit=50` returns a bounded list for authenticated agents.
- `GET /api/settings` exposes only the widget's welcome/announcement settings.

Common error codes include `INVALID_INPUT`, `INVALID_CURSOR`, `UNAUTHORIZED`,
`FORBIDDEN`, `NOT_FOUND`, `RATE_LIMITED`, `CONVERSATION_RESOLVED`,
`IDEMPOTENCY_CONFLICT`, and `INTERNAL_ERROR`. Internal database diagnostics and
message bodies are never included in public errors.
