import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Sprint 15F — checklist de regressão: cada um dos 5 services de IA
 * DEVE continuar chamando `masking.mask` antes de qualquer chamada de
 * `dispatchChat`/`callAiWithFallback`.
 *
 * Este é um teste estrutural (grep no source) para pegar cedo qualquer
 * refactor que remova o masking. Complementa os testes de integração.
 */

const SERVICES = [
  'communication-summary',
  'conversion-rate-suggestion',
  'email-link',
  'document-compare',
  'semantic-search',
] as const;

function readService(name: string): string {
  const path = resolve(process.cwd(), 'src/server/services', `${name}.service.ts`);
  return readFileSync(path, 'utf-8');
}

/**
 * Extrai a região executável (após os `import ...;` iniciais) para não
 * confundir imports com call sites.
 */
function bodyOf(src: string): string {
  // Corta tudo depois do último `import ...;` no topo do arquivo.
  const importMatches = [...src.matchAll(/^import[\s\S]+?from\s+['"][^'"]+['"];?\s*$/gm)];
  if (importMatches.length === 0) return src;
  const lastImport = importMatches[importMatches.length - 1]!;
  const cut = (lastImport.index ?? 0) + lastImport[0].length;
  return src.slice(cut);
}

describe('DataMaskingService preservado nos 5 services', () => {
  for (const svc of SERVICES) {
    it(`${svc} chama masking.mask antes de dispatchChat`, () => {
      const src = readService(svc);
      const body = bodyOf(src);
      const idxMask = body.indexOf('masking.mask');
      const idxDispatch = body.indexOf('dispatchChat');
      expect(idxMask, `${svc}: sem masking.mask`).toBeGreaterThan(-1);
      expect(idxDispatch, `${svc}: sem dispatchChat`).toBeGreaterThan(-1);
      expect(
        idxMask,
        `${svc}: masking.mask deve vir antes de dispatchChat`,
      ).toBeLessThan(idxDispatch);
    });

    it(`${svc} NÃO importa getAnthropicForTenant`, () => {
      const src = readService(svc);
      expect(src).not.toContain('getAnthropicForTenant');
    });
  }
});
