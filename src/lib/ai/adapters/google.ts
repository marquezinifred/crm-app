import { AiProviderError, classifyStatus } from './types';
import type {
  LlmChatParams,
  LlmChatResult,
  LlmClient,
  LlmEmbedParams,
  LlmEmbedResult,
} from './types';

/**
 * Google Gemini adapter via REST direto — evita depender de
 * @google/generative-ai (não instalado). Formato oficial:
 *   POST /v1beta/models/{model}:generateContent?key={apiKey}
 */
const GOOGLE_BASE = 'https://generativelanguage.googleapis.com/v1beta';

export class GoogleAdapter implements LlmClient {
  provider = 'GOOGLE' as const;
  supportsEmbedding = true;

  constructor(private apiKey: string) {}

  async chat(params: LlmChatParams): Promise<LlmChatResult> {
    const contents = params.messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const body = {
      contents,
      generationConfig: {
        maxOutputTokens: params.maxTokens,
        temperature: params.temperature,
      },
      ...(params.systemPrompt
        ? { systemInstruction: { parts: [{ text: params.systemPrompt }] } }
        : {}),
    };

    const url = `${GOOGLE_BASE}/models/${encodeURIComponent(params.model)}:generateContent?key=${encodeURIComponent(this.apiKey)}`;
    const res = await this.fetchJson(url, body);

    const candidates = (res.candidates as
      | Array<{ content?: { parts?: Array<{ text?: string }> } }>
      | undefined) ?? [];
    const parts = candidates[0]?.content?.parts ?? [];
    const text = parts.map((p) => p.text ?? '').join('');
    const usage = (res.usageMetadata as Record<string, number> | undefined) ?? {};

    return {
      text,
      usage: {
        inputTokens: Number(usage.promptTokenCount ?? 0),
        outputTokens: Number(usage.candidatesTokenCount ?? 0),
      },
      raw: res,
    };
  }

  async embed(params: LlmEmbedParams): Promise<LlmEmbedResult> {
    const url = `${GOOGLE_BASE}/models/${encodeURIComponent(params.model)}:batchEmbedContents?key=${encodeURIComponent(this.apiKey)}`;
    const body = {
      requests: params.input.map((text) => ({
        model: `models/${params.model}`,
        content: { parts: [{ text }] },
      })),
    };
    const res = await this.fetchJson(url, body);
    const embeddings = (res.embeddings as
      | Array<{ values?: number[] }>
      | undefined) ?? [];
    const vectors: number[][] = embeddings.map((e) => e.values ?? []);
    return {
      vectors,
      usage: { inputTokens: 0 }, // Google não retorna token count nesse endpoint
    };
  }

  private async fetchJson(
    url: string,
    body: unknown,
  ): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new AiProviderError({
        provider: 'GOOGLE',
        status: null,
        kind: 'UNKNOWN',
        retryable: true,
        message: `Google (network): ${err instanceof Error ? err.message : String(err)}`,
        cause: err,
      });
    }

    const text = await response.text();
    if (!response.ok) {
      const { kind, retryable } = classifyStatus(response.status, text);
      throw new AiProviderError({
        provider: 'GOOGLE',
        status: response.status,
        kind,
        retryable,
        message: `Google HTTP ${response.status}: ${text.slice(0, 300)}`,
      });
    }
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new AiProviderError({
        provider: 'GOOGLE',
        status: response.status,
        kind: 'UNKNOWN',
        retryable: false,
        message: 'Google retornou JSON inválido.',
      });
    }
  }
}
