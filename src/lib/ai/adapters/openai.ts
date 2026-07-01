import OpenAI from 'openai';
import { AiProviderError, classifyStatus } from './types';
import type {
  LlmChatParams,
  LlmChatResult,
  LlmClient,
  LlmEmbedParams,
  LlmEmbedResult,
} from './types';

export class OpenAIAdapter implements LlmClient {
  // Narrowing pra 'OPENAI' quebra a subclasse PerplexityAdapter — usar
  // AIProvider aqui e restringir por construtor da subclasse.
  provider: 'OPENAI' | 'PERPLEXITY' = 'OPENAI';
  supportsEmbedding = true;

  protected client: OpenAI;

  constructor(apiKey: string, opts?: { baseURL?: string }) {
    this.client = new OpenAI({ apiKey, baseURL: opts?.baseURL });
  }

  async chat(params: LlmChatParams): Promise<LlmChatResult> {
    try {
      const messages: OpenAI.ChatCompletionMessageParam[] = [];
      if (params.systemPrompt) {
        messages.push({ role: 'system', content: params.systemPrompt });
      }
      for (const m of params.messages) {
        messages.push({ role: m.role, content: m.content });
      }

      const completion = await this.client.chat.completions.create({
        model: params.model,
        max_tokens: params.maxTokens,
        temperature: params.temperature,
        messages,
      });

      const text = completion.choices[0]?.message?.content ?? '';
      const usage = completion.usage;

      return {
        text,
        usage: {
          inputTokens: usage?.prompt_tokens ?? 0,
          outputTokens: usage?.completion_tokens ?? 0,
        },
        raw: completion,
      };
    } catch (err) {
      throw mapOpenAIError(err, this.provider);
    }
  }

  async embed(params: LlmEmbedParams): Promise<LlmEmbedResult> {
    try {
      const res = await this.client.embeddings.create({
        model: params.model,
        input: params.input,
      });
      return {
        vectors: res.data.map((d) => d.embedding),
        usage: { inputTokens: res.usage.prompt_tokens },
      };
    } catch (err) {
      throw mapOpenAIError(err, this.provider);
    }
  }
}

/**
 * Perplexity implementa API OpenAI-compatible (baseURL diferente).
 * Reusa OpenAIAdapter mudando o cliente e provider tag.
 */
export class PerplexityAdapter extends OpenAIAdapter {
  override supportsEmbedding = false; // Perplexity não expõe embeddings

  constructor(apiKey: string) {
    super(apiKey, { baseURL: 'https://api.perplexity.ai' });
    this.provider = 'PERPLEXITY';
  }

  // Perplexity não suporta embeddings — sobrescreve pra falhar cedo
  override async embed(): Promise<LlmEmbedResult> {
    throw new AiProviderError({
      provider: 'PERPLEXITY',
      status: null,
      kind: 'MODEL_NOT_FOUND',
      retryable: false,
      message: 'Perplexity não expõe endpoint de embeddings.',
    });
  }
}

function mapOpenAIError(
  err: unknown,
  provider: 'OPENAI' | 'PERPLEXITY',
): AiProviderError {
  if (err instanceof OpenAI.APIError) {
    const status = typeof err.status === 'number' ? err.status : null;
    const body = String(err.message ?? '');
    const { kind, retryable } = classifyStatus(status, body);
    return new AiProviderError({
      provider,
      status,
      kind,
      retryable,
      message: `${provider}: ${err.message}`,
      cause: err,
    });
  }
  const message = err instanceof Error ? err.message : String(err);
  return new AiProviderError({
    provider,
    status: null,
    kind: 'UNKNOWN',
    retryable: true,
    message: `${provider} (network): ${message}`,
    cause: err,
  });
}
