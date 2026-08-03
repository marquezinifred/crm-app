import { describe, it, expect } from 'vitest';
import * as React from 'react';
import { render } from '@testing-library/react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { TrpcProvider } from '@/lib/trpc/provider';

/**
 * P-106 — o QueryClient default do app NÃO deve pausar queries/mutations
 * quando `navigator.onLine` reporta `false` (sinal falível). `networkMode:
 * 'always'` garante que as requests seguem em vez de ficarem eternamente
 * "Carregando…".
 *
 * Monta o `TrpcProvider` REAL e captura o QueryClient efetivo via
 * `useQueryClient` — assim o teste guarda o arquivo de produção
 * (`src/lib/trpc/provider.tsx`), não uma cópia do shape.
 */
function Probe({ onClient }: { onClient: (c: QueryClient) => void }) {
  const client = useQueryClient();
  onClient(client);
  return null;
}

function mountAndGetClient(): QueryClient {
  let captured: QueryClient | undefined;
  render(
    <TrpcProvider>
      <Probe onClient={(c) => (captured = c)} />
    </TrpcProvider>,
  );
  if (!captured) throw new Error('QueryClient não capturado');
  return captured;
}

describe('TrpcProvider QueryClient networkMode (P-106)', () => {
  it('queries usam networkMode "always" (não pausam por navigator.onLine falso)', () => {
    expect(mountAndGetClient().getDefaultOptions().queries?.networkMode).toBe('always');
  });

  it('mutations usam networkMode "always"', () => {
    expect(mountAndGetClient().getDefaultOptions().mutations?.networkMode).toBe('always');
  });

  it('preserva staleTime/retry/refetchOnWindowFocus existentes', () => {
    const q = mountAndGetClient().getDefaultOptions().queries;
    expect(q?.staleTime).toBe(30_000);
    expect(q?.retry).toBe(1);
    expect(q?.refetchOnWindowFocus).toBe(false);
  });
});
