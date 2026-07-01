import Anthropic from '@anthropic-ai/sdk';
import { AiProviderError, classifyStatus } from './types';
import type {
  LlmChatParams,
  LlmChatResult,
  LlmClient,
} from './types';

export class AnthropicAdapter implements LlmClient {
  provider = 'ANTHROPIC' as const;
  supportsEmbedding = false;

  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async chat(params: LlmChatParams): Promise<LlmChatResult> {
    try {
      const anthropicMessages = params.messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        }));

      const completion = await this.client.messages.create({
        model: params.model,
        max_tokens: params.maxTokens,
        temperature: params.temperature,
        system: params.systemPrompt,
        messages: anthropicMessages,
      });

      const text = completion.content
        .filter((c): c is Anthropic.TextBlock => c.type === 'text')
        .map((c) => c.text)
        .join('');

      return {
        text,
        usage: {
          inputTokens: completion.usage.input_tokens,
          outputTokens: completion.usage.output_tokens,
        },
        raw: completion,
      };
    } catch (err) {
      throw mapAnthropicError(err);
    }
  }
}

function mapAnthropicError(err: unknown): AiProviderError {
  if (err instanceof Anthropic.APIError) {
    const status = typeof err.status === 'number' ? err.status : null;
    const body = String(err.message ?? '');
    const { kind, retryable } = classifyStatus(status, body);
    return new AiProviderError({
      provider: 'ANTHROPIC',
      status,
      kind,
      retryable,
      message: `Anthropic: ${err.message}`,
      cause: err,
    });
  }
  const message = err instanceof Error ? err.message : String(err);
  return new AiProviderError({
    provider: 'ANTHROPIC',
    status: null,
    kind: 'UNKNOWN',
    retryable: true,
    message: `Anthropic (network): ${message}`,
    cause: err,
  });
}
