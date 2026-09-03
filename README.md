# Relay — AI Cold Email Agent

Relay is a private outreach desk for importing leads, generating grounded cold-email drafts, reviewing each message, and sending only explicitly approved emails through Gmail SMTP. Successful sends are recorded in Supabase.

## Run locally

```bash
pnpm install
pnpm --filter @workspace/ai-cold-email-agent run dev
```

Copy `.env.example` to your local environment and fill in the server-side values. Never commit `.env` files or paste credentials into source code.

## Required services

### OpenAI

Create an OpenAI API key and set `OPENAI_API_KEY`. The default model is `gpt-5-mini`; override it with `OPENAI_MODEL` only if needed.

### Gmail SMTP

Use a Google App Password generated for the sending account. `EMAIL_PASS` may include spaces because the server removes whitespace before authenticating. `EMAIL_FROM` and `REPLY_TO_EMAIL` are optional and default to `EMAIL_USER`.

If an app password has ever been shared publicly or in chat, revoke it and create a replacement before sending.

### Supabase

Run `supabase-schema.sql` in the Supabase SQL editor, then set `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. The service-role key is server-only and must never be exposed to the browser.

## Vercel deployment

This repository includes `vercel.json`, a Vercel serverless API function under `api/cold-email/[...path].ts`, and the Vite static build configuration. Import the repository into Vercel using the repository root as the project root. Vercel will use:

- Install command: `pnpm install --frozen-lockfile`
- Build command: `pnpm --filter @workspace/ai-cold-email-agent run build`
- Output directory: `artifacts/ai-cold-email-agent/dist/public`

Add these variables in Vercel Project Settings → Environment Variables for the environments you deploy:

```text
OPENAI_API_KEY
OPENAI_MODEL
EMAIL_USER
EMAIL_PASS
EMAIL_FROM
REPLY_TO_EMAIL
NEXT_PUBLIC_SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
DASHBOARD_PASSWORD
```

Keep the API key, SMTP credentials, Supabase service-role key, and dashboard password server-only. After deployment, open the app and enter the configured `DASHBOARD_PASSWORD`.

## Sending safeguards

- Leads are parsed in the browser and never uploaded as a file.
- Drafts are generated from the provided lead fields and sender context only.
- Every draft starts unapproved.
- Editing a draft removes its approval.
- The send endpoint rejects any request without `approved: true`.
- Only successful SMTP sends are logged.