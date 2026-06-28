/**
 * Circuit breaker reusável para provedores de IA.
 *
 * Política: após `failureThreshold` falhas dentro de `failureWindowMs`,
 * o circuit abre por `openDurationMs` — toda chamada retorna imediatamente
 * com `circuitOpen: true`, sem tocar no provider.
 *
 * Use uma instância por provider (Claude, Perplexity, etc.) para que
 * problemas em um não derrubem o outro.
 */

export interface BreakerConfig {
  name: string;
  failureThreshold?: number;
  failureWindowMs?: number;
  openDurationMs?: number;
}

export interface BreakerState {
  failures: number[];
  openUntil: number;
}

export class CircuitBreaker {
  private state: BreakerState = { failures: [], openUntil: 0 };
  private readonly threshold: number;
  private readonly windowMs: number;
  private readonly openMs: number;

  constructor(private cfg: BreakerConfig) {
    this.threshold = cfg.failureThreshold ?? 3;
    this.windowMs = cfg.failureWindowMs ?? 60_000;
    this.openMs = cfg.openDurationMs ?? 5 * 60_000;
  }

  isOpen(): boolean {
    return Date.now() < this.state.openUntil;
  }

  recordSuccess(): void {
    this.state.failures = [];
    this.state.openUntil = 0;
  }

  recordFailure(): { opened: boolean } {
    const now = Date.now();
    this.state.failures = this.state.failures.filter((t) => now - t < this.windowMs);
    this.state.failures.push(now);
    if (this.state.failures.length >= this.threshold) {
      this.state.openUntil = now + this.openMs;
      console.warn(`[breaker:${this.cfg.name}] aberto por ${Math.round(this.openMs / 1000)}s`);
      return { opened: true };
    }
    return { opened: false };
  }

  /** Exposto para testes. */
  __reset(): void {
    this.state = { failures: [], openUntil: 0 };
  }
}
