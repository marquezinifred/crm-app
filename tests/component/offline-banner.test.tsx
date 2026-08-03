import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as React from 'react';
import { act, render, screen } from '@testing-library/react';
import { OfflineBanner } from '@/components/layout/OfflineBanner';

/**
 * P-106 — OfflineBanner por heartbeat real (ping no /api/v1/health), não
 * mais por `navigator.onLine` sozinho.
 *
 * Contrato coberto:
 *  - heartbeat OK → banner AUSENTE
 *  - N (=2) falhas de REDE consecutivas → banner APARECE
 *  - sucesso depois de falhas → banner SOME
 *  - latência alta que ainda RESPONDE (mesmo 503) → NÃO marca offline
 *  - eventos window `offline`/`online` disparam ping de verificação
 */

const HEARTBEAT_INTERVAL_MS = 25_000;

/** Resposta HTTP mínima que o componente consome (ele ignora o body/status). */
function httpResponse(status = 200) {
  return { ok: status >= 200 && status < 300, status } as unknown as Response;
}

/** Rejeição típica de falha de rede (fetch lança TypeError sem servidor). */
function networkError() {
  return new TypeError('Failed to fetch');
}

const fetchMock = vi.fn<typeof fetch>();

function bannerVisible() {
  return screen.queryByText('Sem conexão.') !== null;
}

/** Avança o relógio (dispara o interval) e drena as promises do ping. */
async function tickInterval(times = 1) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS);
    });
  }
}

describe('OfflineBanner heartbeat (P-106)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('não renderiza nada no primeiro render (SSR-safe, assume online)', () => {
    fetchMock.mockResolvedValue(httpResponse(200));
    render(<OfflineBanner />);
    // Antes de qualquer ping resolver, banner ausente.
    expect(bannerVisible()).toBe(false);
  });

  it('heartbeat OK → banner ausente', async () => {
    fetchMock.mockResolvedValue(httpResponse(200));
    await act(async () => {
      render(<OfflineBanner />);
    });
    await tickInterval(3);
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/health', expect.objectContaining({ cache: 'no-store' }));
    expect(bannerVisible()).toBe(false);
  });

  it('N falhas de rede consecutivas → banner aparece (1 falha ainda não)', async () => {
    fetchMock.mockRejectedValue(networkError());
    await act(async () => {
      render(<OfflineBanner />);
    });
    // Ping do mount = 1ª falha → ainda NÃO marca offline (absorve blip único).
    expect(bannerVisible()).toBe(false);
    // Próximo interval = 2ª falha consecutiva → offline.
    await tickInterval(1);
    expect(bannerVisible()).toBe(true);
  });

  it('sucesso depois de estar offline → banner some', async () => {
    fetchMock.mockRejectedValue(networkError());
    await act(async () => {
      render(<OfflineBanner />);
    });
    await tickInterval(1);
    expect(bannerVisible()).toBe(true);

    // Rede volta: primeiro sucesso zera o contador e reconecta.
    fetchMock.mockResolvedValue(httpResponse(200));
    await tickInterval(1);
    expect(bannerVisible()).toBe(false);
  });

  it('resposta 503 (DB fail mas servidor alcançável) NÃO marca offline', async () => {
    // O health responde 503 quando o DB falha; a rede alcançou o servidor,
    // logo NÃO é offline — o banner é sobre conectividade, não saúde do backend.
    fetchMock.mockResolvedValue(httpResponse(503));
    await act(async () => {
      render(<OfflineBanner />);
    });
    await tickInterval(3);
    expect(bannerVisible()).toBe(false);
  });

  it('latência alta que ainda retorna 200 NÃO marca offline', async () => {
    // Simula cold-start do Neon (P-110): fetch resolve depois de um atraso
    // dentro do timeout. Enquanto responder, é online.
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          setTimeout(() => resolve(httpResponse(200)), 5_000);
        }),
    );
    await act(async () => {
      render(<OfflineBanner />);
    });
    // Avança além do atraso (5s) mas o suficiente pra resolver os pings.
    await tickInterval(2);
    expect(bannerVisible()).toBe(false);
  });

  it('evento window "offline" dispara um ping de verificação imediato', async () => {
    fetchMock.mockResolvedValue(httpResponse(200));
    await act(async () => {
      render(<OfflineBanner />);
    });
    const callsAfterMount = fetchMock.mock.calls.length;
    await act(async () => {
      window.dispatchEvent(new Event('offline'));
      await vi.advanceTimersByTimeAsync(0);
    });
    // O evento não confia em navigator.onLine: apenas re-verifica via ping.
    expect(fetchMock.mock.calls.length).toBeGreaterThan(callsAfterMount);
    expect(bannerVisible()).toBe(false);
  });

  it('limpa interval e listeners no unmount (sem pings após desmontar)', async () => {
    fetchMock.mockResolvedValue(httpResponse(200));
    let unmount: () => void = () => {};
    await act(async () => {
      ({ unmount } = render(<OfflineBanner />));
    });
    const callsBeforeUnmount = fetchMock.mock.calls.length;
    unmount();
    await tickInterval(3);
    expect(fetchMock.mock.calls.length).toBe(callsBeforeUnmount);
  });
});
