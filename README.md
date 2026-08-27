# Nitros Mobile Technician Portal

Version 10.13.80 adds connection-context verification: disconnected wiring and lines remain unverified unless their mating component or direct damage is visibly supported.

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
