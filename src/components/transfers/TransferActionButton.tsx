'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc/client';
import { friendlyTrpcError } from '@/lib/trpc/error-format';
import { useToast } from '@/components/ui/toast';
import { Modal, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Select, Textarea } from '@/components/ui/input';

/**
 * Sprint 15G.5 Fase 3a — disparo de transferência (P-87).
 *
 * Visibilidade **por-opp** (T13): consome `targetsForOpportunity` com
 * `retry:false`. Se a query erra (FORBIDDEN — sem permission / flag off) OU
 * devolve `[]` → o componente NÃO renderiza nada (nunca decide por flag
 * global). Só com targets é que mostra o botão; ao clicar abre o modal com
 * o Select populado por esses targets + motivo opcional → `request`.
 */
export function TransferActionButton({ opportunityId }: { opportunityId: string }) {
  const utils = trpc.useUtils();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [targetManagerId, setTargetManagerId] = useState('');
  const [reason, setReason] = useState('');

  const targetsQuery = trpc.opportunityTransfers.targetsForOpportunity.useQuery(
    { opportunityId },
    { retry: false },
  );

  const request = trpc.opportunityTransfers.request.useMutation({
    onSuccess: () => {
      toast({ kind: 'success', title: 'Transferência solicitada.' });
      setOpen(false);
      setTargetManagerId('');
      setReason('');
      utils.opportunities.byId.invalidate({ id: opportunityId });
      utils.opportunityTransfers.targetsForOpportunity.invalidate({ opportunityId });
      utils.opportunityTransfers.historyForOpportunity.invalidate({ opportunityId });
    },
    onError: (err) => toast({ kind: 'error', title: friendlyTrpcError(err) }),
  });

  const targets = targetsQuery.data ?? [];
  // T13 — sem targets (erro ou vazio) o disparo não existe pra este user/opp.
  if (targetsQuery.error || targets.length === 0) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded border border-border-strong px-3 py-1.5 text-sm text-text-1 hover:bg-hover"
      >
        Transferir responsabilidade
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Transferir responsabilidade"
        description="Envie a oportunidade para outra equipe. Quem receber decide o novo responsável."
      >
        <div className="space-y-4">
          <Field label="Transferir para" required>
            <Select value={targetManagerId} onChange={(e) => setTargetManagerId(e.target.value)}>
              <option value="">Selecione…</option>
              {targets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.fullName} · {t.role}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Motivo" helper="Opcional — contexto para quem vai receber.">
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="Ex.: cliente é conta enterprise da região Sul."
            />
          </Field>
        </div>

        <ModalFooter>
          <Button variant="ghost" type="button" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            type="button"
            disabled={!targetManagerId}
            loading={request.isLoading}
            onClick={() =>
              request.mutate({
                opportunityId,
                targetManagerId,
                reason: reason.trim() || undefined,
              })
            }
          >
            Solicitar transferência
          </Button>
        </ModalFooter>
      </Modal>
    </>
  );
}
