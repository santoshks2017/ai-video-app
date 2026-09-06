/**
 * Runtime config. The Google API key is read from the environment only
 * (Cloud Run env / Secret Manager) — never shipped to the client (PRD P0.1).
 */

export interface Config {
  port: number;
  /** Present only server-side. Absence is a clear, surfaced error, never a hang. */
  googleApiKey: string | undefined;
  omniFlashModel: string;
  usdPerSecond: number;
  allowOrigin: string;
}

export function loadConfig(): Config {
  return {
    port: Number(process.env.PORT ?? 8080),
    googleApiKey: process.env.GOOGLE_API_KEY || undefined,
    omniFlashModel: process.env.OMNI_FLASH_MODEL ?? 'gemini-omni-1.1-flash',
    usdPerSecond: Number(process.env.USD_PER_SECOND ?? 0.1),
    allowOrigin: process.env.ALLOW_ORIGIN ?? '*',
  };
}
