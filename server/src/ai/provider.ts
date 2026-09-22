import { config } from "../config.js";
import { AnthropicProvider } from "./anthropic.js";

export interface CompletionRequest {
  system: string;
  prompt: string;
  maxTokens?: number;
}

/** Provider-agnostic LLM interface. Add new providers by implementing this and registering below. */
export interface LLMProvider {
  readonly name: string;
  complete(req: CompletionRequest): Promise<string>;
}

let cached: LLMProvider | null | undefined;

/** Returns the configured provider, or null when AI is disabled (the app then uses deterministic rules/templates). */
export function getProvider(): LLMProvider | null {
  if (cached !== undefined) return cached;
  if (config.ai.provider === "anthropic" && config.ai.anthropicApiKey) {
    cached = new AnthropicProvider(config.ai.anthropicApiKey, config.ai.anthropicModel);
  } else {
    cached = null;
  }
  return cached;
}

export function setProviderForTests(p: LLMProvider | null): void {
  cached = p;
}

export function aiStatus(): { enabled: boolean; provider: string; model?: string } {
  const p = getProvider();
  return p ? { enabled: true, provider: p.name, model: config.ai.anthropicModel } : { enabled: false, provider: "none" };
}

/** Extract the first JSON object/array from a model response. */
export function parseJsonResponse<T>(text: string): T | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.search(/[[{]/);
  if (start < 0) return null;
  const end = Math.max(candidate.lastIndexOf("}"), candidate.lastIndexOf("]"));
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}
