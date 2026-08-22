# Nitros Mobile Technician Portal

Version 10.13.44 makes the large Add Evidence control contextual to the active evidence workflow while preserving the permanent toolbar entry point.

## Secure semantic analyzer

Image bytes are sent to `POST /api/semantic-image-analysis`. The server independently verifies the supplied SHA-256, sends the actual image pixels to OpenAI vision, validates a strict structured response, and returns the trusted transaction ID and image hash with the semantic result. The API key remains server-side.

For local verification, save `OPENAI_API_KEY` in the ignored `.env.local` file and run:

```powershell
node server.mjs
```

Then open `http://127.0.0.1:8787/`.

`api/semantic-image-analysis.mjs` is a serverless-compatible endpoint. A production host must deploy that function and configure `OPENAI_API_KEY` as a protected server environment variable. Static GitHub Pages cannot execute the endpoint by itself; when no secure endpoint is available, the PWA intentionally returns `UNKNOWN_OR_ANALYSIS_UNAVAILABLE` and does not make object-recognition claims.

Never add `.env.local`, API keys, bearer tokens, or authorization headers to Git, client JavaScript, the service worker, or GitHub Pages settings.
