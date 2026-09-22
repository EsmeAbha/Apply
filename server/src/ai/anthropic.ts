import Anthropic from "@anthropic-ai/sdk";
import type { CompletionRequest, LLMProvider } from "./provider.js";

export class AnthropicProvider implements LLMProvider {
  readonly name: string;
  private client: Anthropic;

  constructor(apiKey: string, private readonly model: string) {
    this.client = new Anthropic({ apiKey });
    this.name = `anthropic:${model}`;
  }

  async complete(req: CompletionRequest): Promise<string> {
    const stream = this.client.beta.messages.stream({
      model: this.model,
      max_tokens: req.maxTokens ?? 16000,
      thinking: { type: "adaptive" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: req.system,
      messages: [{ role: "user", content: req.prompt }],
    });
    const message = await stream.finalMessage();
    if (message.stop_reason === "refusal") {
      throw new Error("The AI provider declined this request. Nothing was generated.");
    }
    return message.content
      .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
  }
}
