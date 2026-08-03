import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as React from 'react';
import { render, screen } from '@testing-library/react';

/**
 * P-107 (spec §9.5, 15G.5) — o intercepting route `@modal/(.)[id]`
 * captura QUALQUER segmento único sob `/pipeline/*` na navegação SPA.
 * Navegar client-side pra `/pipeline/transferencias-em-andamento`
 * (tela 3c) fazia `byId({ id: "transferencias-em-andamento" })` cair
 * no Zod `zUuid` → "Invalid uuid" transitório no DetailSheet.
 *
 * Este teste prova o guard: id UUID válido → Sheet renderiza + `byId`
 * é habilitado; id não-UUID → componente retorna `null` (o slot @modal
 * não renderiza nada, rota estática assume) + `byId` NÃO é disparado
 * (`enabled: false`).
 *
 * Padrão de mocks: detail-error-friendly.test.tsx (P-95). Stuba o
 * Sheet/Tabs (Radix Dialog) — foco é a lógica do guard, não a UI.
 */

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
}));

vi.mock('@/lib/utils/hooks', () => ({
  useIsMobile: () => false,
}));

vi.mock('@/components/ui/sheet', () => ({
  Sheet: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="detail-sheet">{children}</div>
  ),
  SheetHeader: ({ title }: { title: React.ReactNode }) => <h2>{title}</h2>,
  SheetBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/tabs', () => ({
  Tabs: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TabsList: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TabsTrigger: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
  TabsContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const useQueryCalls: Array<{ input: unknown; opts: unknown }> = [];

vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    opportunities: {
      byId: {
        useQuery: (input: unknown, opts: unknown) => {
          useQueryCalls.push({ input, opts });
          return { data: undefined, isLoading: true, error: null, refetch: vi.fn() };
        },
      },
    },
  },
}));

import PipelineDetailSheet from '@/app/pipeline/@modal/(.)[id]/page';

const VALID_UUID = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  useQueryCalls.length = 0;
});

describe('PipelineDetailSheet — guard UUID (P-107)', () => {
  it('id UUID válido → renderiza o Sheet e habilita byId', () => {
    render(<PipelineDetailSheet params={{ id: VALID_UUID }} />);

    expect(screen.getByTestId('detail-sheet')).toBeInTheDocument();
    expect(useQueryCalls).toHaveLength(1);
    expect(useQueryCalls[0]?.input).toEqual({ id: VALID_UUID });
    expect(useQueryCalls[0]?.opts).toMatchObject({ enabled: true });
  });

  it('id "transferencias-em-andamento" → retorna null, sem disparar byId', () => {
    const { container } = render(
      <PipelineDetailSheet params={{ id: 'transferencias-em-andamento' }} />,
    );

    // slot @modal não renderiza nada → rota estática 3c assume
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId('detail-sheet')).not.toBeInTheDocument();
    // erro Zod transitório nunca chega à tela
    expect(document.body.textContent).not.toMatch(/Invalid uuid/i);
    // hook é chamado (rules-of-hooks), mas a query fica desabilitada
    expect(useQueryCalls).toHaveLength(1);
    expect(useQueryCalls[0]?.opts).toMatchObject({ enabled: false });
  });

  it('outro segmento estático não-UUID (ex.: "transferencias-recebidas") → null', () => {
    const { container } = render(
      <PipelineDetailSheet params={{ id: 'qualquer-rota-futura' }} />,
    );

    expect(container).toBeEmptyDOMElement();
    expect(useQueryCalls[0]?.opts).toMatchObject({ enabled: false });
  });
});
