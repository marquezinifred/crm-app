'use client';

import { useState } from 'react';
import Link from 'next/link';
import { trpc } from '@/lib/trpc/client';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Modal, ModalFooter } from '@/components/ui/modal';
import { CompanyForm } from './CompanyForm';
import { formatRelativeDate } from '@/lib/utils/format';

/**
 * Conteúdo do detalhe de empresa — Sprint fix /companies.
 *
 * Reusado pelo Sheet (intercepting) e pela full-page. 3 tabs:
 * Visão Geral / Contatos / Histórico.
 */
export function CompanyDetailContent({ companyId }: { companyId: string }) {
  const utils = trpc.useUtils();
  const companyQ = trpc.companies.byId.useQuery({ id: companyId });
  const contactsQ = trpc.contacts.list.useQuery({ companyId, page: 1, pageSize: 50 });

  const [editOpen, setEditOpen] = useState(false);
  const [deactivating, setDeactivating] = useState(false);

  const remove = trpc.companies.remove.useMutation({
    onSuccess: () => {
      utils.companies.list.invalidate();
      setDeactivating(false);
    },
    onError: () => setDeactivating(false),
  });

  if (companyQ.isLoading) {
    return (
      <div className="space-y-3 p-2">
        <div className="skeleton h-6 w-3/4" />
        <div className="skeleton h-4 w-1/2" />
        <div className="skeleton h-24" />
      </div>
    );
  }
  if (companyQ.error) {
    return <p role="alert" className="text-body text-danger">{companyQ.error.message}</p>;
  }
  const c = companyQ.data;
  if (!c) return <p className="text-body text-text-2">Empresa não encontrada.</p>;

  return (
    <>
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Visão geral</TabsTrigger>
          <TabsTrigger value="contacts">
            Contatos
            {contactsQ.data && (
              <Badge variant="default">{contactsQ.data.total}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="history">Histórico</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="flex items-start justify-between gap-3 mb-4">
            <div className="min-w-0">
              <h2 className="text-h2 truncate">{c.nomeFantasia ?? c.razaoSocial}</h2>
              {c.nomeFantasia && (
                <p className="text-caption text-text-3">{c.razaoSocial}</p>
              )}
              <div className="flex gap-2 mt-2">
                <Badge variant="default">{c.type}</Badge>
                {c.country && <Badge variant="default">{c.country}</Badge>}
              </div>
            </div>
            <Button variant="secondary" size="sm" onClick={() => setEditOpen(true)}>
              Editar
            </Button>
          </div>

          <dl className="grid grid-cols-2 gap-3 text-body">
            <Item label="CNPJ" value={c.cnpj && formatCnpj(c.cnpj)} mono />
            <Item
              label="Localização"
              value={[c.city, c.state].filter(Boolean).join(' / ')}
            />
            <Item label="Telefone" value={c.phone} />
            <Item label="E-mail" value={c.email} />
            {c.website && (
              <div className="col-span-2">
                <dt className="text-label text-text-3">Site</dt>
                <dd>
                  <a
                    href={c.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-brand-primary-light underline break-all"
                  >
                    {c.website}
                  </a>
                </dd>
              </div>
            )}
            {c.notes && (
              <div className="col-span-2">
                <dt className="text-label text-text-3">Notas</dt>
                <dd className="text-text-1 whitespace-pre-line">{c.notes}</dd>
              </div>
            )}
          </dl>

          <div className="mt-6 pt-4 border-t border-border flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDeactivating(true)}
              disabled={remove.isPending}
            >
              Desativar empresa
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="contacts">
          <header className="flex items-center justify-between mb-3">
            <h3 className="text-h3">Contatos vinculados</h3>
            <Link href={`/contacts?companyId=${c.id}`}>
              <Button variant="secondary" size="sm">+ Adicionar contato</Button>
            </Link>
          </header>
          {contactsQ.data && contactsQ.data.rows.length === 0 && (
            <p className="text-body text-text-2">
              Sem contatos vinculados ainda. Cadastre o primeiro em <code>/contacts</code>.
            </p>
          )}
          <ul className="divide-y divide-border">
            {contactsQ.data?.rows.map((ct) => (
              <li key={ct.id} className="py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-body font-medium text-text-1 truncate">{ct.fullName}</p>
                  <p className="text-caption text-text-2 truncate">
                    {ct.position && `${ct.position} · `}{ct.email}
                  </p>
                </div>
                <Link
                  href={`/contacts/${ct.id}`}
                  className="text-caption text-brand-primary-light hover:underline shrink-0"
                >
                  Abrir →
                </Link>
              </li>
            ))}
          </ul>
        </TabsContent>

        <TabsContent value="history">
          <div className="text-body text-text-2 space-y-2">
            <p>
              Cadastrada em{' '}
              <strong className="text-text-1">
                {new Date(c.createdAt).toLocaleDateString('pt-BR')}
              </strong>{' '}
              ({formatRelativeDate(new Date(c.createdAt))}).
            </p>
            {c.updatedAt && c.updatedAt.getTime?.() !== c.createdAt.getTime?.() && (
              <p>
                Última atualização em{' '}
                <strong className="text-text-1">
                  {new Date(c.updatedAt).toLocaleDateString('pt-BR')}
                </strong>.
              </p>
            )}
            <p className="text-caption text-text-3">
              Histórico detalhado de mudanças está disponível em audit logs (admin).
            </p>
          </div>
        </TabsContent>
      </Tabs>

      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Editar empresa"
        size="lg"
      >
        <CompanyForm
          companyId={c.id}
          onSuccess={() => {
            setEditOpen(false);
            utils.companies.byId.invalidate({ id: c.id });
          }}
          onCancel={() => setEditOpen(false)}
        />
      </Modal>

      <Modal
        open={deactivating}
        onClose={() => setDeactivating(false)}
        title="Desativar empresa?"
        description="A empresa some das listas, mas o histórico fica preservado e pode ser reativado por um admin."
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

function Item({ label, value, mono }: { label: string; value: string | null | undefined; mono?: boolean }) {
  if (!value) return null;
  return (
    <div>
      <dt className="text-label text-text-3">{label}</dt>
      <dd className={mono ? 'font-mono text-text-1' : 'text-text-1'}>{value}</dd>
    </div>
  );
}

function formatCnpj(cnpj: string): string {
  const d = cnpj.replace(/\D/g, '');
  if (d.length !== 14) return cnpj;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}
