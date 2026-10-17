# Engineering Guidelines

## Scope and role

These instructions apply throughout this repository. Act as a senior software engineer responsible for correctness, maintainability, security, and operability. Deliver complete, working changes rather than scaffolding, placeholders, or unnecessarily complex designs.

Project: a live chat support system using Vite, React, TypeScript, Tailwind CSS, Node.js, Express, Socket.io, PostgreSQL, and Redis.

## Before making changes

- Read relevant code, package scripts, configuration, migrations, tests, and any nested AGENTS.md files before editing.
- Identify the existing package manager from the lockfile and use it consistently. Do not introduce competing lockfiles.
- Preserve working conventions. The structure below is a target for new code, not permission to rewrite or move the entire application.
- Trace the affected flow from UI through HTTP or socket events to storage. Fix root causes and consider failure paths.
- Make reasonable decisions independently for reversible work. Ask when missing requirements materially affect behavior, security, compatibility, or destructive operations.
- Keep changes scoped. Do not overwrite unrelated user changes or introduce dependencies without a concrete need.

## Project structure

Prefer a modular monolith with feature-based organization. Use the following layout for a new repository; adapt equivalent existing folders instead of creating duplicates.

```text
apps/
  web/
    src/
      app/                 # Application bootstrap, providers, routing
      features/
        auth/
        conversations/     # Feature components, hooks, API calls, tests
        inbox/
      components/ui/       # Reusable presentation components
      lib/                 # HTTP/socket clients and small shared utilities
      styles/
    public/
  api/
    src/
      app.ts               # Express app construction without listening
      server.ts            # HTTP/socket startup and shutdown
      config/              # Validated environment configuration
      modules/
        auth/
        conversations/
          conversation.routes.ts
          conversation.controller.ts
          conversation.service.ts
          conversation.repository.ts
          conversation.schemas.ts
          conversation.socket.ts
      middleware/          # Authentication, error handling, request context
      infrastructure/      # PostgreSQL, Redis, logging, external integrations
      realtime/            # Socket setup, authentication, event registration
    migrations/
packages/
  contracts/               # Public request/response and socket contracts
tests/
  e2e/                     # Critical cross-application journeys
docs/                      # Setup, architecture decisions, operations
```

- Create folders and layers only when they have real responsibilities. Small features need not contain every file shown above.
- Keep HTTP controllers and socket handlers thin: validate input, resolve authenticated context, call services, map results.
- Services own business rules and transaction boundaries; repositories own persistence queries. Keep transport objects out of business logic.
- Share business operations between HTTP and socket entry points rather than duplicating authorization or persistence logic.
- Keep infrastructure replaceable without building speculative abstractions, generic base repositories, or microservices.
- Share only public contracts with the browser. Never expose server configuration, database models containing private fields, or credentials through shared packages.

## Code quality and TypeScript

- Prefer clear names, small cohesive functions, explicit dependencies, and straightforward control flow.
- Use strict TypeScript for new TypeScript code. Avoid `any`, unchecked casts, and non-null assertions; narrow `unknown` at external boundaries.
- Do not migrate an existing JavaScript backend wholesale as an unrelated change.
- Validate HTTP bodies, parameters, query strings, socket payloads, and environment variables at runtime using the project's existing validation approach.
- Keep public contracts explicit. Represent timestamps as documented ISO 8601 UTC strings across transport boundaries.
- Handle asynchronous errors deliberately. Do not swallow exceptions or return success after failed persistence.
- Comment on reasons, constraints, and non-obvious behavior rather than restating code.
- Follow the existing formatter and linter. Remove obsolete code and debugging output introduced by the change.

## React and user experience

- Use functional components and focused custom hooks. Keep networking and business workflows out of presentation components.
- Keep state local unless multiple consumers need it. Separate server data from transient UI state; use existing data-fetching conventions.
- Provide loading, empty, error, disconnected, reconnecting, and retry states where relevant.
- Clean up socket listeners, timers, and subscriptions. Avoid duplicate handlers under React Strict Mode and stale closures.
- Reuse the socket client through a controlled lifecycle; do not open a new connection on every render.
- Use stable identifiers for list keys. Reconcile optimistic messages with server acknowledgements and show failed sends clearly.
- Use semantic HTML, labels, keyboard access, visible focus states, and accessible status announcements. Preserve readable responsive layouts.
- Reuse Tailwind patterns and existing UI primitives. Extract repeated visual patterns when doing so improves consistency.

## API, authentication, and security

- Authenticate protected HTTP endpoints and socket connections. Authorize each operation against the actual resource and tenant where applicable.
- Never trust client-supplied sender IDs, roles, tenant IDs, or room membership. Derive identity from verified authentication.
- Check conversation access before joining rooms, reading history, sending messages, assigning agents, or changing status.
- Handle expired or revoked authentication for long-lived socket connections; a successful initial handshake is not permanent authorization.
- Use parameterized SQL or safe ORM APIs. Never concatenate user input into queries.
- Apply explicit CORS/origin configuration, request and message size limits, and appropriate rate limits, including socket events.
- Render user content safely. Avoid raw HTML; sanitize any intentionally supported rich content. Protect cookie-authenticated mutations against CSRF.
- Keep secrets in server-side environment variables. Everything exposed through Vite's client environment is public; never place secrets in `VITE_*` variables.
- Commit an `.env.example` with placeholders, not real credentials. Never log passwords, tokens, connection strings, or private message bodies.
- Return consistent, safe errors with stable codes. Log internal diagnostic details on the server without leaking them to clients.

## Real-time chat correctness

- PostgreSQL is the source of truth for durable messages and conversation state. Redis supports cache, presence, and transient coordination.
- Persist messages successfully before acknowledging durable success or broadcasting them as saved.
- Use client-generated idempotency keys scoped to the authenticated sender and conversation, backed by a database uniqueness constraint, to prevent duplicate messages on retries.
- Define typed socket event payloads and acknowledgement results. Provide bounded acknowledgement timeouts and deliberate retry behavior.
- Do not assume exactly-once delivery or reliable arrival order. Reconcile by stable server IDs and documented ordering with a deterministic tie-breaker.
- Recover after reconnect by fetching missed messages from durable storage using a cursor. Do not rely only on socket events for history.
- Account for the gap between committing a message and broadcasting it. Use history reconciliation by default; add a transactional outbox if reliable event publication is required.
- Handle multiple tabs and devices per user. One disconnected socket must not mark the user offline while other connections remain active.
- Use expiring Redis presence records and heartbeat renewal so crashes do not leave users permanently online. Treat typing indicators as ephemeral and throttle them.
- If scaling to multiple backend instances, configure compatible Socket.io coordination and load balancing, including sticky sessions when HTTP long-polling is enabled. An adapter does not replace durable message storage.
- Bound queues, payloads, and reconnect retries. Surface degraded behavior when PostgreSQL or Redis is unavailable instead of silently claiming success.

## PostgreSQL and Redis

- Use versioned migrations for schema changes. Never silently reset databases, delete production data, or rewrite already-applied migrations.
- Enforce important invariants with appropriate foreign keys, unique constraints, and nullability. Use transactions for related writes that must succeed together.
- Design concurrent updates deliberately; use conditional updates or locks where needed to prevent conflicting agent assignments and lost changes.
- Index actual access patterns. Use bounded pagination for history and lists; avoid unbounded reads and N+1 queries.
- Use connection pooling and environment-appropriate TLS settings. Do not disable certificate verification to bypass connection problems.
- Namespace Redis keys, set expiration policies, and document cache invalidation. Do not treat cached authorization as indefinitely valid.
- Consider Redis command volume for presence heartbeats, especially on free hosting plans.

## Testing and verification

- Use existing test tools and package scripts; inspect them before choosing commands. Never invent passing test results.
- Test business behavior and failure cases instead of implementation details. Add regression tests for meaningful bug fixes.
- Use unit tests for business rules, integration tests for persistence and socket flows, and a small number of end-to-end tests for critical journeys.
- Prioritize unauthorized conversation access, retry deduplication, reconnect recovery, message persistence, multiple-tab presence, and concurrent assignment when those flows change.
- Use isolated test databases and Redis namespaces. Never run destructive tests against shared or production services.
- Run relevant formatting, linting, type checking, tests, and production builds using available scripts. If a check cannot run, state the exact limitation.
- Avoid brittle snapshots and tests that merely repeat the implementation. Do not introduce a new testing framework for a trivial change.

## Deployment and operations

- Validate required server environment variables at startup and fail with actionable, non-secret diagnostics.
- Respect the hosting platform's `PORT` and network binding requirements. Keep local, test, and production configuration distinct.
- Handle shutdown gracefully: stop accepting work, close socket and HTTP servers, finish bounded in-flight work, and close database/Redis clients.
- Provide useful health/readiness behavior appropriate to deployment. Use structured logs and request or correlation IDs for debugging.
- Do not assume free hosting is always awake or local files are persistent. Ensure reconnect behavior survives backend restarts.
- Keep setup instructions, environment examples, migrations, and API/event documentation aligned with changed behavior.
- Obtain explicit authorization before production deployment, destructive migrations, or externally visible operations outside the requested scope.

## Completion criteria

A change is complete when the requested behavior works end to end, relevant error paths are handled, appropriate checks pass, and necessary documentation is updated. Do not leave TODO implementations while claiming completion.

In the final response, briefly explain what changed, which checks actually ran and their results, and any remaining limitations or setup steps. Mention architectural tradeoffs only when they matter to the change.
