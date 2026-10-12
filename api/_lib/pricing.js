// Estimated list prices in USD, used for usage_log and the monthly spending cap.
// These are estimates checked on 2026-10-12 from third-party price trackers. Vercel AI Gateway
// bills at provider list price, but verify in Vercel → AI Gateway → Models and update here.
// Override without a deploy of code changes via TRANSCRIBE_USD_PER_MIN.
export const TRANSCRIBE_USD_PER_MIN = {
  'openai/whisper-1': 0.006,
  'openai/gpt-4o-transcribe': 0.006,
  'openai/gpt-4o-mini-transcribe': 0.003,
  'microsoft/mai-transcribe-2': 0.006, // unverified; MAI-Transcribe-1.5 was listed at $0.36/h
};

export function transcriptionCost(model, seconds) {
  const override = Number(process.env.TRANSCRIBE_USD_PER_MIN);
  const perMin = Number.isFinite(override) && override > 0
    ? override
    : TRANSCRIBE_USD_PER_MIN[model] ?? 0.006; // unknown model: assume the common rate
  return Math.round((seconds / 60) * perMin * 1e5) / 1e5;
}
