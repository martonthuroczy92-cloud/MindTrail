# MindTrail

Personal, single-user app: record or upload private conversations, get a transcript, and (from phase 2) reviewed action items and reminders. One owner only, by design. Not for work meetings, not multi-tenant.

**Status: phase 2.**

- **Phase 1:** owner-only sign-in, audio upload, resumable transcription with timestamps, transcript view and search.
- **Phase 2:**
  - Claude extracts a summary and action items.
  - A Review screen where nothing is accepted without you.
  - A Today list with done and snooze.
  - A background scheduler.
  - Cost logging per call.

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
| `ANTHROPIC_API_KEY` | you | **yes** | Claude API key for extraction (phase 2). |
| `EXTRACT_MODEL` | you, optional | no | Default `claude-sonnet-5-5`. |
| `CRON_SECRET` | you | **yes** | At least 32 random characters. Must equal the secret stored in Supabase Vault by `0003_scheduler.sql`. |
| `AI_GATEWAY_API_KEY` | you, **local dev only** | **yes** | Not needed on Vercel (OIDC). |

The integration may add a prefix to the Supabase variables, such as `mindtrail_SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_URL`. The code finds any variable whose name *ends* in the standard name, and an exact name always wins.

**ffmpeg.** The transcription function needs the ffmpeg binary that `ffmpeg-static` downloads in its install script. npm only runs that script because of `"allowScripts"` in `package.json`, which is pinned to the exact version. If you upgrade `ffmpeg-static`, run `npm install-scripts approve ffmpeg-static`. `npm run build` fails if the binary is missing; if that happens on Vercel, redeploy with "Use existing Build Cache" unticked.

## Phase 2: extraction, review, Today

### How extraction works (`api/_lib/extract.js`)

1. After transcription, the job moves to `extracting`. The transcript goes to Claude (`claude-sonnet-5-5`), one line per segment, prefixed with its start time in seconds. Claude also gets the conversation date, your output language and, optionally, your name (`settings.owner_name`).
2. The reply is forced into a JSON schema (structured outputs) and validated again in code, with zod. Invalid output is retried once. A safety refusal is not retried.
3. **No quote, no item:** each item's `source_quote` must be found word for word in the transcript (case and punctuation are ignored). Otherwise the item is dropped. The timestamp is then taken from the transcript, not from the model.
4. Dates are `stated` (said in the conversation, including "next Tuesday") or `suggested` (implied only). The two are shown differently, and an item never gets a date from nothing.
5. Items below confidence 0.6 are marked **Uncertain** on the Review screen.
6. Every Claude call is logged in `usage_log` with its tokens and estimated cost, including failed attempts. The monthly cap stops processing before the next call once spending reaches it.

A failed extraction retries without transcribing again. Re-running extraction never proposes something you already accepted, finished or dismissed.

**Known limit:** transcripts have no speaker labels, so "who promised what" is inferred from wording. Set your name so the model can tell when others address you:

```sql
update public.settings set owner_name = 'Your name';
```

### Setup for phase 2

1. Run `supabase/migrations/0002_phase2.sql` in the SQL editor.
2. In Vercel, add `ANTHROPIC_API_KEY` and `CRON_SECRET`, then redeploy.
3. Edit `supabase/migrations/0003_scheduler.sql`: replace `<<CRON_SECRET>>` with the same secret and `<<APP_URL>>` with your production URL, then run it. Check that it works with `select * from cron.job_run_details order by start_time desc limit 5;`. The status should be `succeeded` within 5 minutes.

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
- **Anthropic:** create a new key in the Claude Console, update `ANTHROPIC_API_KEY`, redeploy, then revoke the old key.
- **CRON_SECRET:** generate a new value (e.g. `openssl rand -hex 32`), set it in Vercel and redeploy, then re-run `0003_scheduler.sql` with the new value. It updates the Vault secret in place.

After any rotation, run `npm run build` locally or check the deploy log for "Secret check passed".

## Limits to know

- **50 MB per file** (Supabase Free). That is about 52 minutes at 128 kbps AAC, or about 3.5 hours at 32 kbps. Set your recorder app to a lower or "speech" quality for long conversations. Phase 3 in-app recording is low-bitrate and chunked, so the limit doesn't affect it.
- **Free Supabase projects pause after 7 days without activity.** Phase 2/3 scheduled jobs will touch the database daily.
- **The spending cap** is checked before each processing run. A run already in progress can exceed it by up to one run's chunks (a few cents).
