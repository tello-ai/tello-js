export const DEFAULT_URL = "ws://localhost:3000/sdk";
export const ENV_API_KEY = "TELLO_API_KEY";
export const ENV_URL = "TELLO_URL";

export type ClientConfig = {
  apiKey: string;
  url: string;
  openTimeoutMs: number;
  closeTimeoutMs: number;
};

export type ClientOptions = {
  apiKey?: string;
  url?: string;
  openTimeoutMs?: number;
  closeTimeoutMs?: number;
};

export function resolveConfig(options: ClientOptions = {}): ClientConfig {
  const apiKey = options.apiKey ?? process.env[ENV_API_KEY];
  if (!apiKey) {
    throw new Error(`apiKey is required (pass apiKey or set ${ENV_API_KEY})`);
  }
  return {
    apiKey,
    url: options.url ?? process.env[ENV_URL] ?? DEFAULT_URL,
    openTimeoutMs: options.openTimeoutMs ?? 10_000,
    closeTimeoutMs: options.closeTimeoutMs ?? 5_000,
  };
}
