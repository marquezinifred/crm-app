'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc/client';
import { friendlyTrpcError } from '@/lib/trpc/error-format';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Modal, ModalFooter } from '@/components/ui/modal';
import { ErrorState } from '@/components/ui/empty-state';
import { useToast } from '@/components/ui/toast';
import { formatRelativeDate } from '@/lib/utils/format';

const RT_LABEL: Record<string, string> = {
  COLABORADOR: 'Colaborador',
  CLIENTE: 'Cliente',
  PARCEIRO: 'Parceiro',
  FORNECEDOR: 'Fornecedor',
  OUTRO: 'Outro',
};

/**
 * Conteúdo do detalhe de contato — Sprint fix /contacts.
 *
 * Reusado pelo Sheet e pela full-page. 3 tabs:
 * Visão Geral / Datas importantes / Histórico.
 */
export function ContactDetailContent({ contactId }: { contactId: string }) {
  const utils = trpc.useUtils();
  const { toast } = useToast();
  const contactQ = trpc.contacts.byId.useQuery({ id: contactId });
  const remove = trpc.contacts.remove.useMutation({
    onSuccess: () => {
      utils.contacts.list.invalidate();
      setDeactivating(false);
      toast({ kind: 'success', title: 'Contato desativado.' });
    },
    onError: (e) => {
      setDeactivating(false);
      toast({ kind: 'error', title: friendlyTrpcError(e) });
    },
  });
  const [deactivating, setDeactivating] = useState(false);

  if (contactQ.isLoading) {
    return (
      <div className="space-y-3 p-2">
        <div className="skeleton h-6 w-3/4" />
        <div className="skeleton h-4 w-1/2" />
        <div className="skeleton h-24" />
      </div>
    );
  }
  if (contactQ.error) {
    // P-95 — nunca renderizar o erro Zod/TRPC cru na tela.
    const notFound = contactQ.error.data?.code === 'NOT_FOUND';
    return (
      <ErrorState
        title={notFound ? 'Contato não encontrado.' : 'Algo saiu errado.'}
        description={
          notFound
            ? 'Ele pode ter sido removido ou o link está incorreto.'
            : friendlyTrpcError(contactQ.error)
        }
        onRetry={notFound ? undefined : () => void contactQ.refetch()}
      />
    );
  }
  const c = contactQ.data;
  if (!c) return <p className="text-body text-text-2">Contato não encontrado.</p>;

  return (
    <>
      <div className="mb-4">
        <h2 className="text-h2">{c.fullName}</h2>
        <p className="text-caption text-text-2 mt-1">
          {c.position ?? '—'}{c.email && ` · ${c.email}`}
        </p>
        <div className="flex gap-2 mt-2 flex-wrap">
          <Badge variant="primary">{RT_LABEL[c.relationshipType] ?? c.relationshipType}</Badge>
          {c.workArea && <Badge variant="default">{c.workArea}</Badge>}
          {c.seniority && <Badge variant="default">{c.seniority}</Badge>}
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Visão geral</TabsTrigger>
          <TabsTrigger value="dates">
            Datas
            {c.importantDates && c.importantDates.length > 0 && (
              <Badge variant="default">{c.importantDates.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="history">Histórico</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <dl className="grid grid-cols-2 gap-3 text-body">
            <Item label="E-mail" value={c.email} />
            <Item label="Telefone" value={c.phone} />
            <Item label="Cargo" value={c.position} />
            <Item label="Função" value={c.function} />
            <Item label="Área" value={c.workArea} />
            <Item label="Especialidade" value={c.specialty} />
            {c.notes && (
              <div className="col-span-2">
                <dt className="text-label text-text-3">Notas</dt>
                <dd className="text-text-1 whitespace-pre-line">{c.notes}</dd>
              </div>
            )}
          </dl>

          <div className="mt-6 pt-4 border-t border-border flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDeactivating(true)}
              disabled={remove.isPending}
            >
              Desativar contato
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="dates">
          {c.importantDates.length === 0 ? (
            <p className="text-body text-text-2">
              Sem datas importantes cadastradas. Aniversários e renovações ativam alertas automáticos.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {c.importantDates.map((d) => (
                <li key={d.id} className="py-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-body font-medium text-text-1">{d.label ?? d.dateType}</p>
                    <p className="text-caption text-text-2">
                      {new Date(d.dateValue).toLocaleDateString('pt-BR')}
                    </p>
                  </div>
                  <Badge variant={d.alertActive ? 'primary' : 'default'}>
                    {d.alertActive ? 'Alerta on' : 'Sem alerta'}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="history">
          <div className="text-body text-text-2 space-y-2">
            <p>
              Cadastrado em{' '}
              <strong className="text-text-1">
                {new Date(c.createdAt).toLocaleDateString('pt-BR')}
              </strong>{' '}
              ({formatRelativeDate(new Date(c.createdAt))}).
            </p>
            <p className="text-caption text-text-3">
              Atividades vinculadas a oportunidades aparecem na página da oportunidade.
              Histórico de alterações detalhado em audit logs (admin).
            </p>
          </div>
        </TabsContent>
      </Tabs>

      <Modal
        open={deactivating}
        onClose={() => setDeactivating(false)}
        title="Desativar contato?"
        description="O contato some das listas, mas o histórico fica preservado."
        size="sm"
      >
        <ModalFooter>
          <Button variant="ghost" onClick={() => setDeactivating(false)}>
            Cancelar
          </Button>
          <Button
            variant="danger"
            loading={remove.isPending}
            onClick={() => remove.mutate({ id: c.id })}
          >
            Desativar
          </Button>
        </ModalFooter>
      </Modal>
    </>
  );
}

function Item({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div>
      <dt className="text-label text-text-3">{label}</dt>
      <dd className="text-text-1">{value}</dd>
    </div>
  );
}
