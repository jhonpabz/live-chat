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

## Partially Implemented Features

- **Typing indicators** — Backend events exist; UI integration is missing.
- **Quick replies** — Database and read API exist; no dashboard picker or editor.
- **Visitor location** — Display and database fields exist; automatic location lookup is missing.
- **Read receipts** — The `messages.is_read` field exists; marking messages as read and displaying receipts are missing.
- **Image messages** — The message-type field exists, but the current send workflow saves text only; secure upload, validation, storage, and image rendering are missing.
- **Agent acceptance and exclusive customer assignment (requested)** — `conversations.agent_id` exists, but there is no accept/claim workflow or assignment enforcement. Currently every authenticated agent can view, reply to, and resolve every conversation; message events are broadcast to the shared agents room. Add an Accept Chat action that atomically assigns an unassigned conversation to one eligible agent. Concurrent accept attempts must produce exactly one owner. Enforce ownership in HTTP APIs, socket events, history access, and event delivery, with explicit super-admin oversight permissions.
- **Online-only chat acceptance (requested)** — Online/offline controls and connection-aware presence exist, but availability does not restrict chat acceptance or replies. New acceptance must require an authenticated, enabled, connected, online agent with available capacity, checked on the server. Define handling of existing chats separately from eligibility for new chats.

## Not yet Implemented Features

The following are planned requirements and suggestions, not completed functionality. Priority 1 establishes the requested BPO workflow; later priorities improve daily operations.

### Priority 1 — Super admin and agent-owned chats

- **Super-admin role and secure initial setup (requested)** — Add explicit `super_admin` and `agent` roles, server-side permission checks, and a secure one-time initial super-admin provisioning process. Current authentication only distinguishes agents from visitors; the existing admin dashboard does not represent a privileged admin role. Prevent ordinary agents from creating accounts or granting themselves privileges.
- **Super-admin agent account creation (requested)** — Provide a protected agent-management page and API to create BPO customer-service accounts with name, unique normalized email, and role fixed to `agent`. Use a time-limited invitation/password-setup flow or securely delivered temporary password requiring replacement. Do not expose public agent registration.
- **Agent account lifecycle (suggested)** — Allow the super admin to list, edit, deactivate, and reactivate agents and initiate secure password resets. Deactivation must invalidate access, terminate active socket sessions, and trigger a defined reassignment policy while retaining historical attribution.
- **Unique-customer and capacity policy (requested; interpretation to confirm)** — Treat each active customer conversation as exclusively owned by one agent, rather than permanently binding a customer to an employee. Proposed starting policy: one active customer chat per agent, with capacity released on resolution or transfer. Enforce the limit atomically, including simultaneous accepts from multiple tabs. If agents should handle multiple customers concurrently, make the limit configurable while retaining one owner per conversation.
- **Waiting queue and My Chats (suggested)** — Separate unassigned waiting chats from the agent's assigned chats. Show limited queue previews and waiting times, an Accept Chat action, and an already-accepted response when another agent wins. Keep private conversation content restricted to authorized users. Let the super admin inspect queue ownership and workload.
- **Ownership and permission regression coverage (suggested)** — Add tests for unauthorized account creation, cross-agent history/message access, event leakage, simultaneous claims, capacity enforcement, offline acceptance, and deactivated sessions before releasing the new workflow.

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

This classification was checked against the source on 2026-10-17; it is not a runtime test report. Evidence: `backend/schema.sql` contains the assignment field but no account-role field; `backend/src/auth.js` authenticates agents and visitors; `backend/src/app.js` has login but no agent-management or acceptance endpoints; `backend/src/chat.service.js` explicitly permits a shared inbox; `backend/src/chat.repository.js` does not assign conversation owners; `backend/src/realtime.js` broadcasts messages to all agents; and `frontend/src/pages/AgentDashboard.tsx` has status controls and resolution but no acceptance or account-management UI.
