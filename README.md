# Nitros Mobile Technician Portal

Version 10.13.142 hardens AI usage verification and cost calibration while preserving the semantic visual-analysis pipeline. Each completed or failed semantic image operation produces one idempotent ledger event in the local server's ignored `data\ai-usage-ledger.json`; provider usage is aggregated across the workflow's internal Responses calls when OpenAI returns it. The deployed Vercel endpoint returns `usageTelemetry` but cannot durably write this file: production-wide ledger persistence requires a configured durable serverless storage adapter before the Vercel route can be claimed as ledger-backed.

The protected local developer dashboard is at `http://localhost:8787/admin/ai-usage`. Set `NITROS_ADMIN_TOKEN` server-side before opening it. Budget settings are persisted with the ledger; `usage-pricing.mjs` is the single model-pricing configuration. GPT-5.6 Sol standard Responses pricing is configured from official OpenAI documentation ($4 input / $0.40 cached input / $20 output per million tokens, verified 2026-09-03); requests identified as fast/non-standard or long-context remain cost-unavailable. `actualProviderCostUsd` remains unavailable unless a provider exposes it. Future providers, BYOK, allowances, and enforcement should produce the same normalized event shape at the server boundary; no credential belongs in browser storage.

### Tomorrow’s field verification

1. Start the local server with `NITROS_ADMIN_TOKEN` configured and open `/admin/ai-usage`; record the current period totals.
2. Open one active RO, submit exactly one known photo, and retain its semantic transaction ID from Developer Mode.
3. Confirm one logical `photo_inspection` ledger event for that transaction, its RO/case/VIN context, status, model(s), provider-call count, token fields, and latency. Multiple provider calls are preserved inside that one logical event.
4. Confirm the cost label: `ESTIMATED` only when provider usage plus a supported standard-model price exists; otherwise `COST UNAVAILABLE`. Never treat unavailable as zero or actual.
5. Refresh the dashboard and confirm today/month totals and the RO/model breakdown changed once. Repeat from a second RO and confirm its cost appears only under the second RO.
6. Exercise a failed request and retry: the failed placeholder must have no invented charge; a success for the same transaction replaces it rather than adding another logical event. Test a server restart only on the local ledger server, where the ignored ledger file persists.

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
