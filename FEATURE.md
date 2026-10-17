# Live Chat Project Features

This list describes the current implementation. Partially implemented features require additional work before they are complete.

## Implemented Features

- **Agent login** — Email/password authentication using JWT and hashed passwords.
- **Real-time messaging** — Visitors and agents exchange text messages through Socket.IO.
- **Floating chat widget** — Visitors can open and close the support window.
- **Admin dashboard** — View conversations, select a chat, and reply.
- **Conversation previews** — Show the latest message and update time.
- **Conversation search** — Filter by visitor ID or latest message text.
- **Saved chat history** — Messages persist in PostgreSQL and load in the admin dashboard.
- **Visitor identification** — Remembers visitors using a locally stored ID.
- **Visitor IP tracking** — Captures and displays the visitor's IP address.
- **Resolve conversations** — Agents can mark conversations as resolved.
- **Automatic replies** — Backend matches visitor messages against knowledge-base entries.
- **Welcome message** — Displays configurable greeting text.
- **Announcement banner** — Displays a configurable announcement when enabled.
- **Widget auto-scroll** — Scrolls to new messages automatically.
- **Keyboard sending** — Press Enter to send messages.

## Partially Implemented Features

- **Agent availability** — Dashboard has an online/offline selector, but the widget's indicator is not connected and stays "Offline."
- **Visitor presence** — Redis tracking and socket events exist, but no dashboard presence indicator.
- **Typing indicators** — Backend events exist; UI integration is missing.
- **Quick replies** — Database and read API exist; no dashboard picker or editor.
- **Visitor location** — Display and database fields exist; automatic location lookup is missing.
- **Read receipts, agent assignment, and image messages** — Database fields exist, but complete workflows are missing.
- **Visitor history restoration** — Returning visitors can reuse an open conversation, but previous messages do not reload in the widget.
