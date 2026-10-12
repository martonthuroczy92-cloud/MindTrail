# MindTrail

Personal, single-user app: record or upload private conversations, get a transcript, and (from phase 2) reviewed action items and reminders. One owner only, by design. Not for work meetings, not multi-tenant.

**Status: phase 1** — sign-in restricted to one email, upload an audio file, asynchronous transcription with timestamps, transcript view, full-text search.

## Architecture

```
Phone (PWA, React + Vite)
  │  1. POST /api/recordings  ──► creates row, returns a signed upload URL
  │  2. upload audio directly  ──► Supabase Storage (private bucket "audio")
  │  3. POST /api/jobs/run     ──► starts the job, returns 202, keeps working in the background
  │  4. polls the jobs table (RLS) and nudges /api/jobs/run if a run stopped
  ▼
Vercel functions (region fra1)
  jobs/run: download → ffmpeg split into 10-min mono MP3 chunks → transcribe each chunk via
            Vercel AI Gateway → save per chunk → stitch → delete audio (retention setting)
Supabase (Frankfurt): Postgres + RLS, Auth (magic link), Storage
Resend: sends the sign-in email
```

Why it is shaped like this:

- **Audio never goes through a function.** Vercel functions accept at most 4.5 MB request bodies, so the browser uploads straight to Storage with a single-use signed URL.
- **Chunking.** Transcription APIs take at most 25 MB per file (OpenAI documents this; a ~25-minute duration cap has also been reported). Every input is converted to 10-minute, 16 kHz mono, 32 kbps MP3 chunks (~2.4 MB each).
- **Async and resumable.** A job runs for at most ~4 minutes, saving each chunk's transcript as it goes. If it runs out of time or fails, the next call continues from the first unfinished chunk, so the audio is never re-uploaded and paid chunks are never re-transcribed. Statuses: `queued → transcribing → ready / failed` (`extracting` arrives in phase 2).
- **Who drives the job.** In phase 1, the open app nudges unfinished jobs while you look at the recording. Phase 2 adds a Supabase `pg_cron` schedule so jobs also finish while the phone is closed.
- **One transcription interface** (`api/_lib/transcribe.js`). Switch models by changing `TRANSCRIBE_MODEL` to any AI Gateway transcription model ID.

## Data model (phase 1)

Changes from the original spec, and why:

| Change | Why |
|---|---|
| `user_id` on every table | RLS policies stay one-liners (`user_id = auth.uid()`), with no joins in policies. |
| New `audio_chunks` table | Per-chunk progress makes jobs resumable and retries cheap. |
| `transcripts.timestamp_precision` | Some models return no segment timestamps. The app then shows chunk-level times and says so. |
| `transcripts.fts` (generated `tsvector`, `simple` config) + GIN index | Search works the same for Hungarian, English and mixed text (no stemming). |
| New `settings` table (one row) | Holds the spending cap and audio retention now, plus later settings. |
| `jobs.locked_until`, `progress`, `attempts` | Prevents two runs working on the same job, and shows progress. |
| `usage_this_month` view (`security_invoker`) | Gives the spend for the cap check. |

Phase 2+ tables (`summaries`, `action_items`, `memory_items`) are added in their own migrations.

## Setup

### 1. Supabase (created through the Vercel Marketplace, Frankfurt)

1. Open the Supabase dashboard (Vercel → Storage → your database → Open in Supabase).
2. **SQL Editor:** open `supabase/migrations/0001_phase1.sql`. Replace `you@example.com` on the marked line with your email, in lower case, then run the whole file.
3. **Authentication → Sign In / Providers:** turn **off** "Allow new users to sign up". The server creates your user through the admin API, and nobody else can register.
4. **Authentication → URL Configuration:** set **Site URL** to your production URL (e.g. `https://mindtrail-xxx.vercel.app`). Add the same URL under **Redirect URLs**, plus `http://localhost:5173` if you develop locally.

### 2. Vercel project

1. Vercel → Add New → Project → import the `MindTrail` GitHub repository. The framework (Vite) is detected from `vercel.json`. This repository's only branch, `claude/meeting-memory-app-70nvp5`, is the GitHub default branch and therefore the production branch.
2. Vercel → Storage → your Supabase database → **Connect Project** → MindTrail. This adds the Supabase variables automatically.
3. Settings → Environment Variables: add the variables marked "you" in the table below.
4. **AI Gateway:** make sure the team has AI Gateway credit (Vercel → AI Gateway). No key is needed in production: deployed functions authenticate with Vercel's OIDC token.
5. Redeploy (Deployments → ⋯ → Redeploy) so the new variables apply.

### 3. Resend

Without a verified domain, Resend's test sender `onboarding@resend.dev` only delivers to the email address of your Resend account. (I recall this rule but couldn't check it against Resend's current docs.) If that address is your `OWNER_EMAIL`, nothing else is needed. Otherwise, verify a domain in Resend and set `MAIL_FROM` to an address on it.

### 4. On your phone (Android, Chrome)

1. Open the production URL in Chrome, enter your email, and open the link from the email **in Chrome on the same phone**.
2. Chrome menu → **Add to Home screen / Install app**. On Android, the installed app shares Chrome's sign-in, so you stay signed in.

## Environment variables

| Name | Set by | Secret? | Purpose |
|---|---|---|---|
| `SUPABASE_URL` | integration | no | Supabase project URL (browser and server). |
| `SUPABASE_ANON_KEY` (or `…_PUBLISHABLE_KEY`) | integration | no, public by design | Browser key. It can only do what RLS allows. |
| `SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_SECRET_KEY`) | integration | **yes** | Server-only admin key. Bypasses RLS, so every query is additionally filtered by your user ID. |
| `OWNER_EMAIL` | you | no | The only email allowed to sign in. Checked on login and on every API call. |
| `RESEND_API_KEY` | you | **yes** | Sends the magic-link email. |
| `MAIL_FROM` | you, optional | no | Sender address; default `MindTrail <onboarding@resend.dev>`. |
| `TRANSCRIBE_MODEL` | you, optional | no | AI Gateway model ID; default `openai/whisper-1`. |
| `TRANSCRIBE_USD_PER_MIN` | you, optional | no | Overrides the price estimate used for the spending cap. |
| `APP_URL` | you, optional | no | Magic-link redirect target. Defaults to Vercel's production URL. |
| `AI_GATEWAY_API_KEY` | you, **local dev only** | **yes** | Not needed on Vercel (OIDC). |

The integration may name the Supabase variables differently, e.g. with a `NEXT_PUBLIC_` prefix. The code accepts the known aliases. Run `vercel env ls` to see yours.

## Local development

```bash
npm install
vercel link && vercel env pull .env.local   # or copy .env.example
vercel dev                                  # app + /api on http://localhost:3000
npm test                                    # unit tests, including a real ffmpeg split
npm run build                               # build + bundle secret check
```

## Security checks

- **No secrets in the bundle.** `npm run build` runs `scripts/check-bundle.mjs`, which fails the build (and so the Vercel deploy) if `dist/` contains any of these:
  - the value of a secret variable;
  - a key-shaped string;
  - a Supabase `service_role` JWT.

  `vite.config.js` also refuses to build if the browser key is a service or secret key. Only two values are injected into the browser, by name: the Supabase URL and the anon key.
- **RLS.** RLS is enabled on every table, with policy `user_id = auth.uid() AND private.is_owner()`. `anon` has no grants. The allowlist table lives in a `private` schema the Data API does not expose.
- **Storage.** The `audio` bucket is private, with a 50 MB per-file limit and **no** client policies. The browser can only upload via single-use signed URLs issued after the owner check, and can never list or download files.
- **Logs.** Errors are logged without request bodies, transcript text, or email addresses (`api/_lib/log.js`).

## Rotating keys

- **Resend:** create a new key in Resend, update `RESEND_API_KEY` in Vercel, redeploy, then delete the old key.
- **Supabase service/secret key:**
  - With the new API keys (Supabase → Settings → API Keys): create a new secret key, update the Vercel variable (or re-sync the integration), redeploy, then delete the old key.
  - With legacy JWT keys: rotating the JWT secret invalidates **both** the anon and the service-role key, and signs you out. Update both variables and redeploy.
- **AI Gateway:** production uses OIDC, so there is no static key to rotate. Rotate a local-dev key under AI Gateway → API Keys.
- **Anthropic** (phase 2): create a new key in the Claude Console, update `ANTHROPIC_API_KEY`, redeploy, then revoke the old key.

After any rotation, run `npm run build` locally or check the deploy log for "Secret check passed".

## Limits to know

- **50 MB per file** (Supabase Free). That is about 52 minutes at 128 kbps AAC, or about 3.5 hours at 32 kbps. Set your recorder app to a lower or "speech" quality for long conversations. Phase 3 in-app recording is low-bitrate and chunked, so the limit doesn't affect it.
- **Free Supabase projects pause after 7 days without activity.** Phase 2/3 scheduled jobs will touch the database daily.
- **The spending cap** is checked before each processing run. A run already in progress can exceed it by up to one run's chunks (a few cents).
