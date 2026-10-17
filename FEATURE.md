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
- **Read receipts, agent assignment, and image messages** — Database fields exist, but complete workflows are missing.
