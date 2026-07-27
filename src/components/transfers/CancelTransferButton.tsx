'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc/client';
import { friendlyTrpcError } from '@/lib/trpc/error-format';
import { useToast } from '@/components/ui/toast';
import { AlertDialog } from '@/components/ui/alert-dialog';

/**
 * Sprint 15G.5 Fase 3a — cancelamento pelo disparador (P-87).
 *
 * A página só renderiza este botão quando o caller é o disparador
 * (`activeTransfer.requestedById === me.id`); o `cancel` do router revalida
 * isso server-side (FORBIDDEN genérico se não for). Ação destrutiva usa
 * `AlertDialog` do design system (nunca `confirm()` nativo).
 *
 * `cancel` do router recebe só `{ transferId }` (sem decisionReason — regra
 * 6 §2: a opp fica com o disparador, owner inalterado).
 */
export function CancelTransferButton({
  transferId,
  opportunityId,
}: {
  transferId: string;
  opportunityId: string;
}) {
  const utils = trpc.useUtils();
  const { toast } = useToast();
  const [confirming, setConfirming] = useState(false);

  const cancel = trpc.opportunityTransfers.cancel.useMutation({
    onSuccess: () => {
      toast({ kind: 'success', title: 'Transferência cancelada.' });
      setConfirming(false);
      utils.opportunities.byId.invalidate({ id: opportunityId });
      utils.opportunityTransfers.targetsForOpportunity.invalidate({ opportunityId });
      utils.opportunityTransfers.historyForOpportunity.invalidate({ opportunityId });
    },
    onError: (err) => toast({ kind: 'error', title: friendlyTrpcError(err) }),
  });

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded border border-border-strong px-3 py-1.5 text-sm text-text-1 hover:bg-hover"
      >
        Cancelar transferência
      </button>

      <AlertDialog
        open={confirming}
        onCancel={() => setConfirming(false)}
        onConfirm={() => cancel.mutate({ transferId })}
        title="Cancelar transferência?"
        description="A oportunidade continua com você. Quem foi notificado será avisado do cancelamento."
        confirmLabel="Sim, cancelar"
        cancelLabel="Voltar"
        tone="danger"
        loading={cancel.isLoading}
      />
    </>
  );
}
