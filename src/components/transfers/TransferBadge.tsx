'use client';

/**
 * Sprint 15G.5 Fase 3a — badge "🔄 Em transferência" (P-87).
 *
 * Presentational puro. A página só renderiza quando `opp.activeTransfer`
 * (byId, flag-gated) não é null — logo o badge nunca "mente" no rollback
 * (T16): flag OFF ⇒ activeTransfer null ⇒ badge não aparece.
 */
export function TransferBadge({ toName }: { toName: string | null }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-warning-bg px-2.5 py-1 text-xs font-medium text-warning-text">
      <span aria-hidden="true">🔄</span>
      {toName ? `Em transferência para ${toName}` : 'Em transferência'}
    </span>
  );
}
