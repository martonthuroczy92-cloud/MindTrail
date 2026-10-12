// Speech-to-text behind one interface, so the provider can be swapped by changing
// TRANSCRIBE_MODEL (any Vercel AI Gateway transcription model id) or by adding another
// implementation here. Contract:
//   transcribe({ audio: Uint8Array, language: 'auto'|'hu'|'en' })
//     → { text, segments: [{ startSecond, endSecond, text }], language, model }
import { gateway, transcribe as aiTranscribe } from 'ai';
import { env } from './env.js';

function providerOptionsFor(model, language) {
  if (language === 'auto') return undefined;
  // OpenAI models accept an ISO-639-1 language hint. Other providers: leave detection to the model.
  if (model.startsWith('openai/')) return { openai: { language } };
  return undefined;
}

export function getTranscriber(model = env.transcribeModel) {
  return {
    model,
    async transcribe({ audio, language = 'auto' }) {
      const result = await aiTranscribe({
        model: gateway.transcription(model),
        audio,
        providerOptions: providerOptionsFor(model, language),
        maxRetries: 2,
      });
      return {
        text: result.text,
        segments: result.segments ?? [],
        language: result.language,
        model,
      };
    },
  };
}
