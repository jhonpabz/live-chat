# Live Chat Project Features

This list describes the current implementation. Partially implemented features require additional work before they are complete.

## Implemented Features

- **Agent availability** — Widget shows Online when at least one connected agent is online, and Offline otherwise. Updates on status changes, connections, and disconnects; tabs for the same agent stay synchronized.
- **Visitor presence** — Dashboard shows Online/Offline indicators in conversation rows and the selected chat header. Reloads presence on reconnect, handles multiple visitor tabs, and shows Unknown while the dashboard is disconnected.
- **Agent login** — Email/password authentication using JWT and hashed passwords.
- **Real-time messaging** — Visitors and agents exchange text messages through Socket.IO.
- **Floating chat widget** — Visitors can open and close the support window.
- **Admin dashboard** — View conversations, select a chat, and reply.
- **Conversation previews** — Show the latest message and update time.
- **Conversation search** — Filter loaded conversations by visitor ID or latest message text; load more conversations to expand the search.
- **Saved chat history** — Messages persist in PostgreSQL and load in the admin dashboard.
- **Visitor identification** — Remembers visitors with a locally stored, server-signed session token; checks ownership before conversation access.
- **Visitor IP tracking** — Captures and displays the visitor's IP address.
- **Resolve conversations** — Agents can mark conversations as resolved.
- **Automatic replies** — Backend matches visitor messages against knowledge-base entries.
- **Welcome message** — Displays configurable greeting text.
- **Announcement banner** — Displays a configurable announcement when enabled.
- **Widget auto-scroll** — Scrolls to new messages automatically.
- **Keyboard sending** — Press Enter to send messages.
- **Confirmed sends and safe retries** — Clears the composer after server acknowledgement. Unconfirmed sends can be retried with the same database-backed idempotency key.
- **Visitor history restoration** — Reloads saved messages after refresh and reconnect, with cursor-based recovery and controls to load earlier messages.
- **Connection and failure states** — Shows loading, reconnecting, expired-session, failed-request, and degraded-presence states.
- **Bounded history and conversation lists** — Uses pagination instead of unbounded reads.
- **Operational checks** — Validates startup configuration, exposes health/readiness endpoints, and closes connections during shutdown.

### Priority 1 - Super admin and agent-owned chats (implemented)

- **Super-admin setup and roles** - One-time CLI provisioning, single-use password setup, verified database roles, and protected account-management APIs.
- **Agent invitations and lifecycle** - Super admins create agents, edit names/emails/capacity, deactivate/reactivate accounts, and issue expiring password-reset links. Deactivation revokes all sessions and requeues open work while retaining assignment history.
- **Multiple active chats with exclusive ownership** - Each conversation has one owner. Each agent has configurable capacity (default five, range 1-100), enforced transactionally across simultaneous accepts and tabs.
- **Waiting Queue and My Chats** - Online agents accept redacted queue entries; only owners and super admins can access private messages. Super admins have All Chats oversight and workload visibility in agent management.
- **Connection-aware acceptance** - New acceptance requires an active, connected, online agent with capacity. Offline agents may finish owned chats; disconnects preserve ownership.
- **Regression coverage** - Isolated PostgreSQL and real HTTP/socket tests cover account permissions, token expiry/reuse, claim races, capacity, cross-agent access, event privacy, and session revocation.

See [setup, permissions, and operation](docs/agent-ownership.md). Setup-link delivery is manual; no email provider is configured.

## Partially Implemented Features

- **Typing indicators** — Backend events exist; UI integration is missing.
- **Quick replies** — Database and read API exist; no dashboard picker or editor.
- **Visitor location** — Display and database fields exist; automatic location lookup is missing.
- **Read receipts** — The `messages.is_read` field exists; marking messages as read and displaying receipts are missing.
- **Image messages** — The message-type field exists, but the current send workflow saves text only; secure upload, validation, storage, and image rendering are missing.

## Not yet Implemented Features

The following are planned requirements and suggestions, not completed functionality. Priority 1 is implemented above; these later priorities extend daily operations.

### Priority 2 — BPO operations

- **Chat transfer and escalation** — Let an assigned agent request a transfer to an eligible agent and let the super admin reassign or take over explicitly. Retain history and attribution, prevent duplicate ownership, and notify affected users.
- **Disconnect and shift-end recovery** — Preserve assignment through a short reconnect grace period; after that, requeue or escalate according to a documented policy. Handle multiple tabs correctly and show the customer when their agent is unavailable.
- **Away, busy, and wrap-up states** — Expand the existing online/offline workflow with break and post-chat states. Define which states allow new acceptance and keep availability consistent across tabs.
- **Audit trail** — Record account creation, role changes, deactivation, acceptance, transfers, and resolution with actor, target, time, and outcome. Restrict audit access and exclude credentials and message bodies.
- **Internal notes and conversation tags** — Let authorized staff attach customer-invisible notes and categories for follow-up, handover, and reporting. Ensure notes are never emitted to visitor clients.
- **Waiting-time and response alerts** — Track queue wait, first response, and unanswered customer messages; notify the responsible agent or super admin when configured thresholds are exceeded.

### Priority 3 — Customer experience and reporting

- **Offline contact and business hours** — Collect a follow-up request when nobody is available and show configured support hours. The current Offline label alone does not provide an offline follow-up workflow.
- **Post-chat satisfaction feedback** — Request a rating and optional comment after resolution, tied to the conversation and protected against repeated submissions.
- **Super-admin reporting** — Report queue size, active chats per agent, first-response time, resolution time, and satisfaction. Define metrics and time ranges explicitly and scope access to authorized staff.

### Verification notes

Priority 1 was updated on 2026-10-21. Relevant implementation: `backend/src/accounts.service.js`, `backend/src/chat.service.js`, `backend/src/chat.events.js`, migration `002_agent_ownership.sql`, and the agent-management/inbox frontend. Verification commands and scope are documented in `docs/agent-ownership.md`.
