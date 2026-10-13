# Website-guided Public API integration — 2026-10-13

## Result

The working booking app is in `the demo checkout` and runs at `http://127.0.0.1:3000`. It uses the local Slotkit API at port 8000. At the original validation handoff, files were uncommitted and nothing was deployed. The demo was subsequently prepared for publication as an integration reference. No Slotkit API implementation, migration, or external contract changed.

The initial public website was enough to identify the API and understand one Booking request, but not enough to implement a reliable customer booking lifecycle without filling gaps from internal knowledge. After adding the public quickstart and downloadable raw HTTP helper, the website-only consumer script successfully completed discovery → Slots → creation → read → reschedule → cancellation using only public downloads and supplied server configuration.

This is evidence for this bounded flow, not a claim that every Public API/Invitation/Webhook/checkout integration has been independently exercised.

## Gaps found and resolved on the website

| Initial gap | Published guidance |
|---|---|
| How to get a genuinely bookable Event Type/key | Owner setup, Host/availability/Calendar activation, capacity, least-privilege scope matrix; Google login vs Calendar connection |
| Base URL and local runtime configuration | Production/local origins without `/v1` suffix, separate local workspace/key, no built-in Public API Google simulator |
| SDK distribution unavailable | Raw HTTP examples plus downloadable server-only Node helper; no unpublished monorepo dependency |
| Day range/timezone and Slot selection | Inclusive local dates, one-day query, 31-day limit, IANA timezone, exact server-returned start, no client-owned end time |
| Handling outcomes and retry identity | Success/error envelopes, original 201 replay, stable codes, request IDs, Retry-After, persistent payload/key before network, timeout ambiguity, 24-hour window |
| Managing customer Bookings safely | Customer-to-Booking ownership separate from Tenant-wide API Key authority, CSRF/Origin, current versions, no Guest-email list filter |
| Calendar/communications expectations | Confirmed vs pending synchronization, null Meeting URL, polling option, API Guest mail exclusion, Google attendee updates separate |
| Webhook guidance too vague | Purpose, headers/raw HMAC/tolerance, rotation, Event ID deduplication/version checks, public HTTPS receiver requirement; not implemented in this polling demo |

The guide is shared in English on all eight localized `/docs` pages, explicitly labeled English. Existing translations were preserved; translating the new guide is not claimed.

## Files and contracts

Slotkit:

- `apps/website/src/pages/docs.astro` renders the new guide.
- `apps/website/src/components/content/en/StaticArticle.astro` adds the quickstart entry link.
- `apps/website/src/components/content/BookingQuickstart.astro` contains the guide and exact HTTP examples.
- `apps/website/public/examples/slotkit-client.mjs` is the downloadable server-side example.
- `docs/assessments/public-api-website-integration.md` records this exercise.

Demo:

- `src/server.mjs`, `src/slotkit-client.mjs`, `src/store.mjs`: trusted backend, Public API client, SQLite operations/customer ownership.
- `public/index.html`, `public/app.js`, `public/style.css`: browser booking experience, retry restoration and management.
- `tests/integration.test.mjs`: meaningful failure/persistence/concurrency tests.
- `scripts/live-check.mjs`, `scripts/verify-local.sh`, `scripts/public-guide-check.mjs`: real HTTP and public-source-only checks.
- `scripts/*local*.php`, `configure-local.php`, `calendar-state.php`, `invalidate-calendar.php`, `start-local.sh`, `stop-local.sh`: explicit local fixture lifecycle/adapter/fault/start-stop harness.
- `.gitignore`, `.env.example`, `package.json`, README and this report.

No migration. No new Slotkit API routes, DTOs, scopes, error codes, identifiers, or schema versions. Demo-owned endpoints: `GET /api/config`, `/api/event`, `/api/slots`, `/api/bookings`; `POST /api/bookings`, `/api/bookings/{id}/reschedule`, `/api/bookings/{id}/cancel`. They allowlist one Event Type and session-owned management; no generic privileged proxy.

## Verification evidence

| Command/check | Result |
|---|---|
| Demo `npm test` | 5 passed: ambiguous response/restart preserves key, duplicate concurrency once, payload mismatch, retry delay, expiry reconciliation, error/request ID/Retry-After, cursor handling |
| Demo `npm run test:live` | Passed real HTTP create/read/replay/reschedule/cancel, direct API idempotency conflict, taken Slot, stale version, invalid key, denied scope, opaque pagination, foreign/missing safe 404, session ownership and Origin denial, simulated Google 503 envelope; scoped foreign fixture removed |
| Demo `npm run test:guide` | Passed using website-downloaded helper + OpenAPI only; operations persisted before outbound requests; Booking cancelled |
| API `php artisan test --compact --filter='PublicApiTest\|PublicOpenApiContractTest'` (from `apps/api`) | 7 passed, 114 assertions; ordinary hermetic SQLite/fake-provider tests |
| Website `pnpm --filter @slotkit/website test` | Astro check, build, and `check-build.mjs` passed: 88 pages, links, metadata, SEO, page-size budgets; includes lint/typecheck logic |
| `make health` | All standard local surfaces passed (final verification) |
| `git diff --check` and new-file whitespace review | Passed |
| Demo `npm ls --all`, Node syntax checks and `bash -n` | No npm dependencies; all syntax checks passed |
| Demo `scripts/stop-local.sh` then `scripts/start-local.sh` | Passed restore/restart procedure; demo left running with scoped simulator |
| Served asset scan | No fixture API keys in demo HTML/JS/CSS/config/event or website docs/helper/OpenAPI; `.env`, fixture, SQLite and server-source paths return 404 |
| Browser via computer use | Create, reschedule, fake Calendar sync, cancel; final screenshot retained |
| Root `npm test` (broader than required) | Failed in existing unrelated `BookingReschedulePanel.test.tsx:105`: expects button `10:00 AM GMT`; 701 Webapp tests passed and 1 failed. No Webapp files modified. Website checks passed independently. |

Full backend quality/tests, fresh migrations, real Google OAuth/Meet, real SMTP, forced real rate limits, Webhook delivery/signature round trip, payments, full E2E and production build/deployment were not performed. No backend/migration change warranted destructive migration verification. Mock tests do not prove those external protocols. Real integration checks exercised PostgreSQL, Redis, RabbitMQ and actual API/worker services, with only the Google adapter simulated for synthetic credentials.

## State and side effects

The new project directory, ignored mode-0600 `.env`/fixture files, SQLite DB, simulated Calendar event store, and screenshot were written outside the Slotkit repository. Synthetic User/workspace/Host/availability/Calendar/Event Types/key and Booking/operation/billing/outbox history were created in Slotkit-owned services. The demo key expires seven days after creation and uses only four booking scopes; a separate Event Type read-only test key is also retained in the private fixture. The original broad fixture key was revoked. Temporary cross-Tenant fixtures were removed, and test Bookings were cancelled.

The existing `slotkit-dev` API and worker panes now run task-owned native Artisan wrappers. They intercept only the synthetic fixture's Calendar token, leaving normal credentials on their ordinary paths. A `demo` window was added. `stop-local.sh` pauses the synthetic connection before restoring ordinary API/worker processes; this avoids sending its credentials to Google. The demo remains running for user review as requested. `make dev-stop` stops the full dev session.

The user's existing untracked `apps/website/CLAUDE.md` and ignored Slotkit `.env` were preserved. No shared container was started/stopped/replaced, no unrelated data was changed, no key or secret was printed or added to browser assets, and no live external provider was invoked for synthetic data. No production deployment or live provider operation was part of validation.
