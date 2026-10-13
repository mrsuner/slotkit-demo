# Slotkit booking app reference

Build your own booking experience on the [Slotkit Public API](https://slotkit.app/docs/api-reference). This small reference app shows the complete flow: choose a time, create a Booking, read its state, reschedule it, and cancel it.

It uses **plain Node.js, HTML, CSS, and JavaScript**. No Next.js, frontend build step, npm dependencies, or unpublished SDK is required.

```text
Customer browser ── your backend ── Slotkit Public API /v1
                       │
                  SQLite database
             operations + Booking ownership
```

The browser calls only this app's backend. Its API Key stays on the server. Slotkit remains authoritative for availability, Booking state, overlap checks, versions, and Calendar synchronization.

## Quick start with your own Slotkit workspace

### 1. Prepare Slotkit

In Slotkit Administration:

1. Create or select your workspace, then configure a Host and availability schedule.
2. Connect Google Calendar and select conflict-check and destination Calendars. Google **sign-in** does not connect Calendar. Calendar is required even when the Meeting type is `none`.
3. Create and activate an Event Type. Keep the workspace/Host active and ensure the workspace has Booking capacity.
4. As Owner, create an API Key with only the scopes below. Complete recent reauthentication if requested, and copy the key into your server's secret configuration; it is shown only once.

| Scope | Used for |
|---|---|
| `event_types:read` | Discover the configured Event Type |
| `slots:read` | Retrieve available Slots |
| `bookings:read` | Read authoritative Booking state |
| `bookings:write` | Create, reschedule, and cancel |

Keys cannot administer Hosts, schedules, Calendars, keys, or Webhooks. Complete those tasks in Administration. See the [public documentation](https://slotkit.app/docs) and [OpenAPI contract](https://slotkit.app/api/openapi.yaml) for the complete API.

### 2. Configure and run the app

Requires Node.js **22.13 or later**. SQLite is experimental in Node 22.

```sh
git clone git@github.com:mrsuner/slotkit-demo.git
cd slotkit-demo
cp .env.example .env
chmod 600 .env
```

Edit `.env` locally, replacing the placeholder key and Event Type ID:

```dotenv
SLOTKIT_BASE_URL=https://api.slotkit.app
SLOTKIT_API_KEY=replace-with-your-server-side-key
SLOTKIT_EVENT_TYPE_ID=replace-with-your-bookable-event-type-id
DEMO_ORIGIN=http://127.0.0.1:3000
DEMO_PORT=3000
```

`SLOTKIT_BASE_URL` is the API **origin without `/v1`**. Use HTTPS outside local development. For your own locally running Slotkit instance, use `http://127.0.0.1:8000` and a key created in that local instance. Local and hosted environments have separate resources and credentials.

Use an authorized server-side `GET /v1/event-types` request to find the opaque Event Type ID. Choose one with `bookable: true`; inspect `unavailable_reason` and fix Administration setup when false. Lists use `meta.next_cursor`; follow it until null without parsing it.

```sh
npm run dev
```

Open **http://127.0.0.1:3000**. No `npm install` is needed. Choose a future date within your Event Type's booking horizon, select a Slot, and enter Guest details. The UI defaults to two days ahead. Stop the app with Ctrl+C.

The app binds only to `127.0.0.1`. Keep `DEMO_ORIGIN` equal to the exact browser origin, including its port; opening `localhost` when configured for `127.0.0.1` fails the Host/Origin checks.

**Never commit `.env`, expose the key through public environment variables, or send it to the browser.** `.gitignore` also excludes SQLite data, fixture credentials, screenshots, and logs.

## Understand the integration

### Discover → list Slots → confirm

[`src/slotkit-client.mjs`](src/slotkit-client.mjs) implements raw HTTP calls with bearer authentication, envelopes, opaque cursor pagination, stable errors/request IDs, Retry-After parsing, and timeout uncertainty. It does not automatically retry mutations.

For a single local day:

```js
const { envelope } = await client.slots(eventTypeId, date, date, 'Asia/Bangkok');
const selectedSlot = envelope.data[0];
```

`from` and `to` are **inclusive Guest-local dates**; ranges cover at most 31 dates. Use an IANA timezone. An empty array means no Slots in that window. Send the selected Slot's UTC `start_at` unchanged; do not calculate the Booking end time or supply your own Host/Tenant identity.

Creation sends:

```js
{
  event_type_id: eventTypeId,
  start_at: selectedSlot.start_at,
  guest: { name: guestName, email: guestEmail, timezone: guestTimezone }
}
```

A successful creation returns **201** with the Booking under `data` and a correlation ID in `meta.request_id`. Store the Booking ID and its customer relationship before acknowledging success. A Slot is not reserved by listing it: another customer can take it before confirmation.

### Persist each operation before sending

[`src/store.mjs`](src/store.mjs) demonstrates the crucial retry boundary:

1. Persist an operation ID, action/path, canonical payload hash, exact payload, and creation time.
2. Send its stable `Idempotency-Key` to Slotkit.
3. Persist the result and customer-to-Booking relationship before replying to the browser.
4. On timeout or a lost response, retain an **uncertain** outcome and retry the same path, payload, and key.

Identical replay returns the original status/result, including 201. Reusing a key with changed input produces `idempotency_conflict`. Concurrent duplicates share the operation. Retry identity survives an app restart because it is stored in SQLite, not generated for every HTTP attempt.

Slotkit retains idempotency records for 24 hours. This demo blocks unresolved retries after 23 hours and requests reconciliation. A genuinely new action gets a new key after the prior outcome is known. The browser also preserves its pending request across refresh and freezes edits while its result is unresolved.

### Read and manage the customer's Booking

[`src/server.mjs`](src/server.mjs) allowlists one Event Type and checks session ownership before managing a Booking. A Tenant API Key has workspace-wide authority; knowing an opaque Booking ID is not customer authorization.

The demo uses a host-only HttpOnly `SameSite=Strict` cookie, stores its hash server-side, checks Host/Origin, and accepts JSON mutations. Production apps should associate Bookings with their established customer identities rather than relying on this demo's 24-hour anonymous cookie.

Read the current Booking before an action. Reschedule sends a freshly listed Slot's `start_at` plus `expected_version`. Cancel optionally takes `expected_version`. Both return **200** with the complete current Booking.

| Response | Handling |
|---|---|
| `401 invalid_api_key` | Check key configuration, expiry/revocation, and workspace access |
| `403 insufficient_scope` | Correct the key scopes in Administration |
| `404 resource_not_found` | Treat as unavailable; foreign resources have the same safe response |
| `409 slot_no_longer_available` | Refresh Slots and choose again after the rejection is known |
| `409 booking_version_conflict` | Read the Booking again, then submit a new action with its current version |
| `409 idempotency_conflict` | Fix retry bookkeeping; do not silently create another Booking |
| `422 validation_failed` / `operation_not_allowed` | Correct fields or resolve resource state/capacity |
| `429` / `503` | Honor Retry-After and keep the original mutation payload/key |

Branch on `error.code`, preserve `error.request_id`, and treat `error.details` as an array. The demo also reports `outcome_unknown` locally for network/unreadable-response failures; that is a client recovery signal, not a Slotkit API error code.

### Confirmation and Calendar synchronization are separate

A Booking may already be `confirmed` while `calendar.status` is `pending` and `meeting.join_url` is null. Read the Booking again to update that presentation; use **Refresh bookings** in this demo. Do not wait for Calendar synchronization before acknowledging confirmed state.

API-created Bookings do not receive Slotkit Hosted Guest confirmation/management emails. Your app owns customer communications and access. Google attendee updates are separate and depend on Event Type configuration. This reference uses reads rather than a Webhook receiver.

## Code map

| Files | Responsibility |
|---|---|
| `src/server.mjs` | Fixed browser endpoints, customer authorization, API orchestration |
| `src/slotkit-client.mjs` | Server-only Public API HTTP client |
| `src/store.mjs` | SQLite sessions, operations, and customer-to-Booking ownership |
| `public/` | Booking UI, timezone selection, mutation recovery, management |
| `tests/integration.test.mjs` | Deterministic persistence, concurrency and failure tests |
| `scripts/` | Optional local Slotkit provisioning/simulation/verification harness |

Demo routes are `GET /api/config`, `/api/event`, `/api/slots`, `/api/bookings`, and `POST /api/bookings`, `/api/bookings/{id}/reschedule`, `/api/bookings/{id}/cancel`. These are **this app's routes**, not additions to Slotkit's Public API. There is no arbitrary privileged proxy.

## Tests

```sh
npm test
```

Five tests cover durable recovery after a lost response/restart, stable keys, concurrent duplicates, payload conflicts, retry delays, expired uncertain operations, safe transport/errors/request IDs, and opaque pagination. They use fakes; they do not prove a live provider protocol.

## Optional local Slotkit simulation

This section is for contributors who also have a **compatible Slotkit source checkout** and its local environment running. Ordinary consumers need only the quick start above. The harness depends on Slotkit's internal E2E fixture helpers; it is not a public API setup mechanism or a bundled Slotkit server.

```sh
export SLOTKIT_SOURCE_DIR=/path/to/your/slotkit
bash scripts/start-local.sh
npm run test:live
npm run test:guide
```

The default source location is a sibling `../slotkit` checkout. The harness uses the existing `slotkit-dev` tmux session, default Slotkit ports, and a `demo` window on port 3000. It does not create/start/stop shared infrastructure. PHP, tmux, lsof, ripgrep, curl, and the configured Slotkit development dependencies are required.

It creates a synthetic workspace and a seven-day, four-scope demo key in ignored server files. A separate read-only fixture key supports denied-scope tests. Only this fixture's Calendar token is intercepted; Google free/busy and event storage are simulated while actual local Slot generation, transactions, billing, PostgreSQL, Redis, RabbitMQ, and worker reconciliation run normally. No live Google calls are made for this fixture.

`test:live` creates/removes a separate synthetic Tenant, cancels its Bookings, tests authorization/ownership/idempotency/versions and simulated dependency failure, and restores availability. `test:guide` downloads the public helper/OpenAPI from the local website on port 4321 and completes a persisted Booking lifecycle without importing Slotkit internals. These synthetic checks are restricted to the API on port 8000.

```sh
bash scripts/stop-local.sh
```

This stops the demo, pauses its synthetic Calendar, and restores ordinary Slotkit API/worker processes. `make dev-stop` in Slotkit stops the whole development session. To rotate the synthetic demo key, run `php scripts/configure-local.php` with `SLOTKIT_SOURCE_DIR` exported, then restart the harness. Live tests consume local Booking capacity; they are not a production test suite.

## Before using this as a production app

This is an integration reference. Add durable customer identity/recovery, abuse limits, communications, operation/session retention, backups, and deployment-specific security. Clearing or expiring the demo cookie removes management access. There is no email delivery, payment/checkout flow, Webhook receiver, or production deployment configuration here.

Validate real Google OAuth/Calendar/Meet separately. Simulation does not prove Google compatibility, and mocked rate-limit/network tests do not prove real quota or lost-response behavior. See [INTEGRATION_REPORT.md](INTEGRATION_REPORT.md) for the original exercise's evidence and limits.
