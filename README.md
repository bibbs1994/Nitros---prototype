# Nitros Mobile Technician Portal

Version 10.13.141 adds server-side AI usage and budget instrumentation while preserving the semantic visual-analysis pipeline. Each completed or failed semantic image operation produces one idempotent ledger event in the local server's ignored `data\ai-usage-ledger.json`; provider usage is aggregated across the workflow's internal Responses calls when OpenAI returns it. Missing token or actual-cost fields stay `null` rather than being invented.

The protected local developer dashboard is at `http://localhost:8787/admin/ai-usage`. Set `NITROS_ADMIN_TOKEN` server-side before opening it. Budget settings are persisted with the ledger; `usage-pricing.mjs` is the single model-pricing configuration. `actualProviderCostUsd` remains unavailable unless a provider exposes it; `estimatedCostUsd` is calculated only for explicitly configured rates. Future providers, BYOK, allowances, and enforcement should produce the same normalized event shape at the server boundary; no credential belongs in browser storage.

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
