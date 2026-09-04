# Nitros Mobile Technician Portal

Version 10.13.144 adds direct Vercel Marketplace Upstash environment compatibility to the production durable AI usage ledger without changing the established semantic or visual-diagnostic reasoning pipeline. The Vercel write path records server-derived OpenAI Responses usage in a Redis/Valkey-compatible REST datastore; the protected admin API reads and aggregates that datastore for `/admin/ai-usage`.

## Durable AI usage ledger

### Architecture and data flow

Production data follows one authoritative path:

`semantic-image-analysis server function -> provider response telemetry -> durable-ai-usage-ledger.mjs -> Redis/Valkey REST -> protected /api/admin/ai-usage -> /admin/ai-usage dashboard`

`semantic-analyzer-core.mjs` captures one telemetry record at the existing fetch boundary for every individual OpenAI Responses call; instrumentation does not make another provider request. Each record identifies the stable visual stage and response schema, request/response timestamps, elapsed time, returned response ID/model/service tier/status, independent HTTP and local schema-validation outcomes, retry attempt, timeout state, provider usage fields, image-input count, and non-sensitive image detail/media-type metadata. It never records an image URL, base64 payload, prompt, authorization header, or credential. `api/semantic-image-analysis.mjs` creates one immutable ledger event per provider call while retaining the shared technician `logicalOperationId`. The original request's RO, case, vehicle, and VIN snapshot is copied into every event at creation; a later active-vehicle or active-RO change cannot move historical attribution.

Stable stage labels cover semantic classification, whole-image visual condition, its reserved retry, the regional whole-image sweep, candidate localization, localized verification, connector fallback observation, component identification, component-relationship reasoning, graph/PID interpretation and recovery, wiring-diagram analysis, and repair-document extraction. HTTP success does not imply schema acceptance: both are stored separately, and a response can be HTTP 200 while its locally parsed contract is `REJECTED`. Provider-level fields that OpenAI omits remain null/`UNAVAILABLE`; the ledger does not invent image resolution, token usage, provider cost, or timing data.

`durable-ai-usage-ledger.mjs` uses Redis `SET ... NX` for atomic duplicate prevention, a sorted-set index for chronological reads, and server-side aggregation from `ai-usage-ledger.mjs`. A provider response ID is the preferred idempotency identity. When a provider response ID is unavailable, the fallback is the logical operation ID plus the provider-call index. Distinct retry calls therefore remain distinct while duplicate delivery of the same call remains one event.

The normalized event schema includes event/timestamp identity, `logicalOperationId`, `providerRequestId`, `upstreamCallIndex`, operation type, RO/case/vehicle/VIN attribution, returned provider/model fields, input/cached/cache-write/output/reasoning/total token counts, per-call and end-to-end latency, operation and provider-call status, HTTP/schema/retry/timeout status, image-input metadata, and one explicit cost state. `ACTUAL_PROVIDER_COST`, `ESTIMATED_CALCULATED_COST`, and `UNAVAILABLE` remain separate, with dashboard provenance labels `ACTUAL`, `ESTIMATED`, and `COST UNAVAILABLE`. Unknown price or insufficient usage never becomes `$0.00`; budget usage and projections become unavailable when the period contains an unknown-cost provider call.

Server aggregation groups provider events into one logical photo inspection. It reports total calls, tokens, image inputs, accounted cost by provenance, end-to-end duration, the separate sum of call durations, recorded execution mode, slowest/costliest stages, retry and timeout counts, and final operation status. This release records the existing visual pipeline as `SEQUENTIAL`; it does not introduce parallelism or the proposed hybrid/two-call design.

`usage-pricing.mjs` is the single server-side price table. GPT-5.6 Sol standard Responses rates were verified from the official OpenAI model documentation on 2026-09-03; unrecognized models, non-standard service tiers, and explicitly identified long-context tariffs remain `UNAVAILABLE` until an authoritative rate is configured. Provider-reported actual charges always remain distinct from calculated estimates.

### Required server environment variables

- `OPENAI_API_KEY` — existing protected key used only by the semantic server path.
- `NITROS_ADMIN_TOKEN` — administrator bearer token required by the company-wide usage API.
- `KV_REST_API_URL` plus `KV_REST_API_TOKEN` — native Vercel Marketplace Upstash write-capable REST pair.
- `AI_USAGE_REDIS_REST_URL` plus `AI_USAGE_REDIS_REST_TOKEN` — optional application-specific override pair.

Credential resolution is pair-safe and deterministic: a complete `AI_USAGE_REDIS_REST_URL` + `AI_USAGE_REDIS_REST_TOKEN` pair wins; otherwise a complete `KV_REST_API_URL` + `KV_REST_API_TOKEN` pair is used. A partial override fails closed and is never mixed with the Vercel pair. `KV_REST_API_READ_ONLY_TOKEN` is never selected because the ledger requires write access. Health/status responses expose only `AI_USAGE_OVERRIDE`, `VERCEL_UPSTASH`, or `NOT_CONFIGURED`, never URLs or tokens.

`AI_USAGE_LEDGER_STORE` is optional and local-only; it overrides the ignored JSON file used by `server.mjs`. It is not production durable storage.

### Production configuration

The recommended Vercel-compatible integration is Upstash Redis from the Vercel Marketplace because it supplies a serverless Redis-compatible REST service. The Marketplace listed Free, Pay as You Go, and Fixed options when this version was built; Bobby must review the current limits and select the appropriate plan during setup. A connected Marketplace installation automatically provisions `KV_REST_API_URL` and the write-capable `KV_REST_API_TOKEN`; version 10.13.144 consumes those variables directly. Do not duplicate, reveal, copy, or recreate those credentials. The `AI_USAGE_*` pair remains available only when an intentional application-specific override is needed.

Production requires `OPENAI_API_KEY`, `NITROS_ADMIN_TOKEN`, and either complete Redis pair. When the Vercel Upstash integration has already provisioned `KV_REST_API_URL` and `KV_REST_API_TOKEN` for Production and Preview, no credential duplication is required. Preview should point to an intentionally approved datastore because its usage events will be durable; use a separate preview database when production isolation is required. Local Development uses the ignored JSON ledger by default and does not require Redis.

Deployment before Redis variables exist is safe for the diagnostic result because accounting failure is isolated, logged only by a safe error code, and returned in server diagnostics. It is not a complete production-accounting deployment: the dashboard shows `DURABLE STORAGE: NOT CONFIGURED`, permanent totals are hidden, and usage occurring before configuration is not backfilled.

### Protected read path and status behavior

The production dashboard fetches only `/api/admin/ai-usage` with the administrator bearer token. It has no browser, local-storage, or in-memory fallback. The server returns only these storage states and never returns datastore connection details:

- `DURABLE STORAGE: CONFIGURED` — authenticated health check and durable read succeeded.
- `DURABLE STORAGE: NOT CONFIGURED` — required durable variables are missing or invalid; permanent totals remain hidden.
- `DURABLE STORAGE: DEGRADED` — configuration exists but the datastore health/read failed; permanent totals remain hidden.

The API supports server-side filters for time range, RO, case, operation, model, and status. Dashboard aggregation covers today, week, month, logical-operation count, provider calls/retries, photo inspections, success/failure, average cost per request and RO, model/operation/RO breakdowns, recent transactions, and monthly budget used/remaining/projected values where they are mathematically valid. Each photo inspection is expandable into its ordered provider stages with model, latency, token breakdown, image count/detail, cost provenance, HTTP result, schema acceptance, retry attempt, and timeout state. Operation totals are shown above the stage table.

### Security and failure behavior

All provider and datastore credentials remain server-side. Event construction ignores browser-supplied token or cost totals and uses telemetry captured from the server's provider response. Recursive sanitization strips secret-, credential-, authorization-, password-, API-key-, and token-named fields before persistence and again before admin serialization. The admin API uses a timing-safe bearer-token comparison, no-store responses, and no unauthenticated cost access.

Redis network, protocol, malformed-response, and write failures are classified separately from image analysis. A ledger failure never replaces or destroys a successful diagnostic/vision result. The returned diagnostic exposes only `PERSISTED`, `UNCONFIGURED`, or `FAILED` plus a safe error code. Local development persists atomically to ignored `data\ai-usage-ledger.json` and labels the dashboard `LOCAL DEVELOPMENT STORAGE`, so local totals cannot be mistaken for production durable totals.

### Connection verification with no OpenAI cost

After deploying version 10.13.144, open `/admin/ai-usage`, enter `NITROS_ADMIN_TOKEN`, and select Unlock/refresh. A `DURABLE STORAGE: CONFIGURED` result with safe source label `VERCEL_UPSTASH` proves the protected API resolved the native Vercel pair and completed Redis `PING` and read commands. This does not call OpenAI and creates no OpenAI charge. A direct authenticated `GET /api/admin/ai-usage` is equivalent; never place the bearer token in a URL, screenshot, source file, or shared log.

### Field-test procedure after configuration

1. Perform the no-OpenAI-cost connection check and record the current durable totals.
2. Open RO A with its intended vehicle and submit exactly one known diagnostic photo. Retain the logical transaction ID from Developer Mode and the returned ledger status.
3. Confirm the diagnostic result is unchanged and `usageLedgerWriteStatus` is `PERSISTED`.
4. Refresh the dashboard. Confirm the logical operation appears once, every provider call/retry has its own provider response ID where supplied, all calls share the logical operation ID, and RO A/case/vehicle/VIN attribution matches the captured request.
5. Confirm each row is explicitly `ACTUAL`, `ESTIMATED`, or `COST UNAVAILABLE`; never accept unknown as zero. Confirm model, operation, today/week/month, and budget aggregations.
6. Switch to RO B and a different vehicle, submit one intentional test photo, and refresh. Confirm the new events belong only to RO B and the prior RO A records did not move.
7. Refresh/retry the dashboard read and confirm it does not duplicate either provider response ID. If the diagnostic workflow legitimately makes multiple provider attempts, confirm each unique response ID is retained under the one logical operation.
8. Temporarily test with a non-production datastore outage only if operationally safe. Confirm the dashboard reports `DEGRADED` and hides totals while a successful diagnostic result remains usable. Restore the datastore and confirm `CONFIGURED`.

## Local test server

Run `powershell -ExecutionPolicy Bypass -File .\Start-NitrosTestServer.ps1` from this project to host the local test API on port `8787`. The launcher finds `node.exe`, starts `server.mjs` from the repository root, binds to `0.0.0.0` for private-LAN testing, and records non-secret startup output under `data\logs`. It does not create a firewall rule, router rule, tunnel, or public DNS record.

The local support dashboard is available at `http://localhost:8787/dashboard` and, on the private LAN, `http://192.168.4.24:8787/dashboard`. Tickets are durably stored in the ignored local file `data\support-tickets.json` using atomic write-and-rename updates.

For private-LAN testing, the mobile support-ticket queue posts to `http://192.168.4.24:8787/api/support-tickets` and preserves a local retry record whenever the server is unavailable. Load the portal from the MSI LAN server (`http://192.168.4.24:8787/`) for this test path. A portal loaded from HTTPS GitHub Pages cannot post to this HTTP-only LAN endpoint because browsers block mixed content; no browser-security bypass is used.

## Secure semantic analyzer

Image bytes are sent to `POST /api/semantic-image-analysis`. The server independently verifies the supplied SHA-256, sends the actual image pixels to OpenAI vision, validates a strict structured response, and returns the trusted transaction ID and image hash with the semantic result. The API key remains server-side.

For local verification, save `OPENAI_API_KEY` in the ignored `.env.local` file and run:

```powershell
node server.mjs
```

Then open `http://127.0.0.1:8787/`.

`api/semantic-image-analysis.mjs` is a serverless-compatible endpoint. A production host must deploy that function and configure `OPENAI_API_KEY` as a protected server environment variable. Static GitHub Pages cannot execute the endpoint by itself; when no secure endpoint is available, the PWA intentionally returns `UNKNOWN_OR_ANALYSIS_UNAVAILABLE` and does not make object-recognition claims.

Never add `.env.local`, API keys, bearer tokens, or authorization headers to Git, client JavaScript, the service worker, or GitHub Pages settings.
