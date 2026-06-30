'use client';

import { useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc/client';
import { useState, useId } from 'react';
import {
  ContactRelationshipType,
  ContactSeniority,
  WorkArea,
} from '@prisma/client';
import { useToast } from '@/components/ui/toast';
import { QuickCreateTrigger } from '@/components/ui/quick-create-trigger';

const RT_LABEL: Record<ContactRelationshipType, string> = {
  COLABORADOR: 'Colaborador',
  CLIENTE: 'Cliente',
  PARCEIRO: 'Parceiro',
  FORNECEDOR: 'Fornecedor',
  OUTRO: 'Outro',
};

const WA_LABEL: Record<WorkArea, string> = {
  COMERCIAL: 'Comercial',
  MARKETING: 'Marketing',
  COMPRAS: 'Compras',
  USUARIO_SERVICOS_PRODUTOS: 'Usuário dos serviços/produtos',
  OUTRO: 'Outro',
};

type FormState = {
  id?: string;
  fullName: string;
  email: string;
  phone: string;
  position: string;
  workArea: '' | WorkArea;
  seniority: '' | ContactSeniority;
  relationshipType: ContactRelationshipType;
  companyId: string;
  notes: string;
};

const EMPTY: FormState = {
  fullName: '',
  email: '',
  phone: '',
  position: '',
  workArea: '',
  seniority: '',
  relationshipType: 'CLIENTE',
  companyId: '',
  notes: '',
};

export default function ContactsPage() {
  const router = useRouter();
  const utils = trpc.useUtils();
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [workAreaFilter, setWorkAreaFilter] = useState<'' | WorkArea>('');
  const [rtFilter, setRtFilter] = useState<'' | ContactRelationshipType>('');
  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const formTitleId = useId();

  const contacts = trpc.contacts.list.useQuery({ search: search || undefined });
  const companies = trpc.companies.list.useQuery({ pageSize: 100 });

  const create = trpc.contacts.create.useMutation({
    onSuccess: (c) => {
      utils.contacts.list.invalidate();
      toast({ kind: 'success', title: `${c.fullName} adicionado como contato.` });
      setForm(EMPTY);
      setErrors({});
    },
    onError: (e) => setErrors({ form: e.message }),
  });
  const update = trpc.contacts.update.useMutation({
    onSuccess: (c) => {
      utils.contacts.list.invalidate();
      toast({ kind: 'success', title: `Dados de ${c.fullName} atualizados.` });
      setForm(EMPTY);
      setErrors({});
    },
    onError: (e) => setErrors({ form: e.message }),
  });
  const remove = trpc.contacts.remove.useMutation({
    onSuccess: () => {
      utils.contacts.list.invalidate();
      toast({ kind: 'success', title: 'Contato desativado.' });
    },
  });

  const visibleContacts = (contacts.data?.rows ?? []).filter((c) => {
    if (workAreaFilter && c.workArea !== workAreaFilter) return false;
    if (rtFilter && c.relationshipType !== rtFilter) return false;
    return true;
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    const payload = {
      fullName: form.fullName.trim(),
      email: form.email.trim(),
      phone: form.phone.trim() || null,
      position: form.position.trim() || null,
      workArea: form.workArea || null,
      seniority: form.seniority || null,
      relationshipType: form.relationshipType,
      companyId: form.companyId || null,
      notes: form.notes.trim() || null,
    };
    if (form.id) update.mutate({ id: form.id, ...payload });
    else create.mutate(payload);
  }

  return (
    <main className="p-6 md:p-10 max-w-6xl mx-auto space-y-8">
      <header>
        <h1 className="text-2xl font-semibold">Contatos</h1>
        <p className="text-sm text-text-2">
          Gerencie pessoas vinculadas a empresas e oportunidades.
        </p>
      </header>

      <section
        aria-labelledby={formTitleId}
        className="border rounded-lg p-5 bg-card"
      >
        <h2 id={formTitleId} className="text-lg font-semibold mb-4">
          {form.id ? 'Editar contato' : 'Novo contato'}
        </h2>
        <form onSubmit={submit} className="grid md:grid-cols-2 gap-4" noValidate>
          <Field label="Nome completo" required>
            <input
              required
              value={form.fullName}
              onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))}
              className="input"
            />
          </Field>
          <Field label="E-mail" required>
            <input
              type="email"
              required
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              className="input"
            />
          </Field>
          <Field label="Telefone">
            <input
              type="tel"
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              className="input"
              placeholder="(11) 99999-9999"
            />
          </Field>
          <Field label="Cargo">
            <input
              value={form.position}
              onChange={(e) => setForm((f) => ({ ...f, position: e.target.value }))}
              className="input"
            />
          </Field>
          <Field label="Empresa">
            <div className="flex items-center gap-2">
              <select
                value={form.companyId}
                onChange={(e) => setForm((f) => ({ ...f, companyId: e.target.value }))}
                className="input flex-1"
              >
                <option value="">— Sem empresa —</option>
                {companies.data?.rows.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nomeFantasia ?? c.razaoSocial}
                  </option>
                ))}
              </select>
              <QuickCreateTrigger
                entity="company"
                triggerLabel="+ Nova"
                onCreated={(id) => {
                  setForm((f) => ({ ...f, companyId: id }));
                  utils.companies.list.invalidate();
                }}
              />
            </div>
          </Field>
          <Field label="Área de atuação">
            <select
              value={form.workArea}
              onChange={(e) =>
                setForm((f) => ({ ...f, workArea: e.target.value as WorkArea | '' }))
              }
              className="input"
            >
              <option value="">—</option>
              {Object.entries(WA_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Tipo de relacionamento">
            <select
              value={form.relationshipType}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  relationshipType: e.target.value as ContactRelationshipType,
                }))
              }
              className="input"
            >
              {Object.entries(RT_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Senioridade">
            <select
              value={form.seniority}
              onChange={(e) =>
                setForm((f) => ({ ...f, seniority: e.target.value as ContactSeniority | '' }))
              }
              className="input"
            >
              <option value="">—</option>
              <option value="PROPRIETARIO">Proprietário</option>
              <option value="DIRETOR">Diretor</option>
              <option value="GERENTE">Gerente</option>
              <option value="COORDENADOR">Coordenador</option>
              <option value="ANALISTA">Analista</option>
              <option value="OUTRO">Outro</option>
            </select>
          </Field>
          <Field label="Notas" className="md:col-span-2">
            <textarea
              rows={3}
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              className="input"
            />
          </Field>

          {errors.form && (
            <p role="alert" className="md:col-span-2 text-sm text-danger">
              {errors.form}
            </p>
          )}

          <div className="md:col-span-2 flex gap-2">
            <button
              type="submit"
              disabled={create.isPending || update.isPending}
              className="px-4 py-2 rounded-md bg-brand text-white hover:opacity-90 focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50"
            >
              {form.id ? 'Salvar alterações' : 'Criar contato'}
            </button>
            {form.id && (
              <button
                type="button"
                onClick={() => {
                  setForm(EMPTY);
                  setErrors({});
                }}
                className="px-4 py-2 rounded-md border hover:bg-page"
              >
                Cancelar
              </button>
            )}
          </div>
        </form>
      </section>

      <section aria-label="Lista de contatos" className="border rounded-lg bg-card">
        <div className="p-4 border-b flex flex-wrap gap-3 items-end">
          <Field label="Buscar nome/e-mail">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input"
              placeholder="Digite para filtrar"
            />
          </Field>
          <Field label="Área">
            <select
              value={workAreaFilter}
              onChange={(e) => setWorkAreaFilter(e.target.value as WorkArea | '')}
              className="input"
            >
              <option value="">Todas</option>
              {Object.entries(WA_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Relacionamento">
            <select
              value={rtFilter}
              onChange={(e) =>
                setRtFilter(e.target.value as ContactRelationshipType | '')
              }
              className="input"
            >
              <option value="">Todos</option>
              {Object.entries(RT_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">
              Lista de contatos do tenant atual
            </caption>
            <thead className="bg-page">
              <tr>
                <th scope="col" className="text-left px-4 py-2 font-medium">Nome</th>
                <th scope="col" className="text-left px-4 py-2 font-medium">E-mail</th>
                <th scope="col" className="text-left px-4 py-2 font-medium">Cargo</th>
                <th scope="col" className="text-left px-4 py-2 font-medium">Área</th>
                <th scope="col" className="text-left px-4 py-2 font-medium">Relacionamento</th>
                <th scope="col" className="text-right px-4 py-2 font-medium">Ações</th>
              </tr>
            </thead>
            <tbody>
              {contacts.isLoading && (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-text-2">
                    Carregando...
                  </td>
                </tr>
              )}
              {!contacts.isLoading && visibleContacts.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-text-2">
                    Ninguém com esses filtros. Ajuste a busca ou cadastre um contato.
                  </td>
                </tr>
              )}
              {visibleContacts.map((c) => (
                <tr
                  key={c.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => router.push(`/contacts/${c.id}`)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      router.push(`/contacts/${c.id}`);
                    }
                  }}
                  className="border-t cursor-pointer hover:bg-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
                >
                  <td className="px-4 py-2 font-medium">{c.fullName}</td>
                  <td className="px-4 py-2 text-text-2">{c.email}</td>
                  <td className="px-4 py-2 text-text-2">{c.position ?? '—'}</td>
                  <td className="px-4 py-2 text-text-2">
                    {c.workArea ? WA_LABEL[c.workArea] : '—'}
                  </td>
                  <td className="px-4 py-2 text-text-2">
                    {RT_LABEL[c.relationshipType]}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setForm({
                          id: c.id,
                          fullName: c.fullName,
                          email: c.email,
                          phone: c.phone ?? '',
                          position: c.position ?? '',
                          workArea: c.workArea ?? '',
                          seniority: c.seniority ?? '',
                          relationshipType: c.relationshipType,
                          companyId: c.companyId ?? '',
                          notes: '',
                        });
                      }}
                      className="px-2 py-1 text-xs rounded border hover:bg-page focus-visible:ring-2 focus-visible:ring-brand-primary"
                    >
                      Editar
                    </button>{' '}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`Remover ${c.fullName}?`)) remove.mutate({ id: c.id });
                      }}
                      className="px-2 py-1 text-xs rounded border text-danger hover:bg-danger-bg focus-visible:ring-2 focus-visible:ring-danger"
                    >
                      Remover
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <style jsx>{`
        .input {
          width: 100%;
          border: 1px solid rgb(229 229 229);
          border-radius: 6px;
          padding: 0.5rem 0.75rem;
          font-size: 0.875rem;
        }
        .input:focus {
          outline: 2px solid var(--brand-primary, #7C3AED);
          outline-offset: 1px;
        }
      `}</style>
    </main>
  );
}

function Field({
  label,
  required,
  children,
  className,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <label htmlFor={id} className={`block ${className ?? ''}`}>
      <span className="text-sm font-medium text-text-1">
        {label}
        {required && (
          <span aria-hidden="true" className="text-danger ml-0.5">
            *
          </span>
        )}
      </span>
      <div className="mt-1">
        {/* Children inherit the id via aria-labelledby via wrapper */}
        {Array.isArray(children) || typeof children !== 'object'
          ? children
          : // Inject id+aria-required into the first child element
            withId(children as React.ReactElement, id, required)}
      </div>
    </label>
  );
}

function withId(child: React.ReactElement, id: string, required?: boolean): React.ReactElement {
  return {
    ...child,
    props: {
      ...child.props,
      id,
      'aria-required': required ? 'true' : undefined,
    },
  } as React.ReactElement;
}
