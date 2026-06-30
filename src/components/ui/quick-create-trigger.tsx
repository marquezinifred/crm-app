'use client';

import * as React from 'react';
import { trpc } from '@/lib/trpc/client';
import { useToast } from './toast';
import { Modal, ModalFooter } from './modal';
import { Button } from './button';
import { Field } from './field';
import { Input, Select } from './input';
import {
  CompanyType,
  ProductType,
  ContactRelationshipType,
} from '@prisma/client';
import { formatCNPJ, unformatCNPJ } from '@/lib/utils/format';

/**
 * QuickCreateTrigger — Sprint 15C.
 *
 * Botão + Dialog que cria entidades (empresa / contato / produto) sem
 * tirar o usuário do formulário pai. Ao confirmar, dispara
 * `onCreated(id, name)` para o formulário pai marcar o campo
 * selecionado.
 *
 * Recursão limitada: dentro do dialog de contato, pode-se abrir um
 * dialog de empresa (1 nível). Não acumula mais.
 */

export type QuickCreateEntity = 'company' | 'contact' | 'product';

export interface QuickCreateTriggerProps {
  entity: QuickCreateEntity;
  onCreated: (id: string, name: string) => void;
  triggerLabel?: string;
  /** Se true, esconde o botão (uso por formulários que controlam UI). */
  hidden?: boolean;
}

export function QuickCreateTrigger({
  entity,
  onCreated,
  triggerLabel,
  hidden,
}: QuickCreateTriggerProps) {
  const [open, setOpen] = React.useState(false);
  const label =
    triggerLabel ??
    (entity === 'company'
      ? '+ Criar empresa'
      : entity === 'contact'
        ? '+ Criar contato'
        : '+ Criar produto');

  if (hidden) return null;

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="text-brand-primary-light"
        onClick={() => setOpen(true)}
      >
        {label}
      </Button>
      {open && entity === 'company' && (
        <CompanyQuickCreate
          onCancel={() => setOpen(false)}
          onCreated={(id, name) => {
            setOpen(false);
            onCreated(id, name);
          }}
        />
      )}
      {open && entity === 'contact' && (
        <ContactQuickCreate
          onCancel={() => setOpen(false)}
          onCreated={(id, name) => {
            setOpen(false);
            onCreated(id, name);
          }}
          recursionDepth={0}
        />
      )}
      {open && entity === 'product' && (
        <ProductQuickCreate
          onCancel={() => setOpen(false)}
          onCreated={(id, name) => {
            setOpen(false);
            onCreated(id, name);
          }}
        />
      )}
    </>
  );
}

// ─── Company ─────────────────────────────────────────────────────────

function CompanyQuickCreate({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (id: string, name: string) => void;
}) {
  const { toast } = useToast();
  const segments = trpc.segments.list.useQuery();
  const [form, setForm] = React.useState({
    razaoSocial: '',
    cnpj: '',
    segmentId: '',
    phone: '',
    type: CompanyType.CLIENT as CompanyType,
  });
  const [error, setError] = React.useState<string | null>(null);
  const create = trpc.companies.create.useMutation({
    onSuccess: (data) => {
      toast({ kind: 'success', title: `${data.razaoSocial} adicionada ao seu portfólio.` });
      onCreated(data.id, data.razaoSocial);
    },
    onError: (e) => setError(e.message),
  });

  return (
    <Modal
      open
      onClose={onCancel}
      title="Nova empresa"
      description="Dados mínimos. Você completa o resto depois."
      size="md"
    >
      <form
        className="grid md:grid-cols-2 gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          create.mutate({
            type: form.type,
            razaoSocial: form.razaoSocial,
            cnpj: form.cnpj ? form.cnpj : null,
            segmentId: form.segmentId || null,
            phone: form.phone || null,
            country: 'BR',
          });
        }}
      >
        <Field label="Razão social" required className="md:col-span-2">
          <Input
            required
            autoFocus
            value={form.razaoSocial}
            onChange={(e) => setForm({ ...form, razaoSocial: e.target.value })}
          />
        </Field>
        <Field label="CNPJ" helper="Opcional. Auto-fill BrasilAPI no form completo.">
          <Input
            value={formatCNPJ(form.cnpj)}
            onChange={(e) => setForm({ ...form, cnpj: unformatCNPJ(e.target.value) })}
            placeholder="00.000.000/0000-00"
            maxLength={18}
          />
        </Field>
        <Field label="Tipo">
          <Select
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value as CompanyType })}
          >
            <option value="CLIENT">Cliente</option>
            <option value="PARTNER">Parceiro</option>
            <option value="SUPPLIER">Fornecedor</option>
          </Select>
        </Field>
        <Field label="Segmento">
          <Select
            value={form.segmentId}
            onChange={(e) => setForm({ ...form, segmentId: e.target.value })}
          >
            <option value="">—</option>
            {segments.data?.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Telefone">
          <Input
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            placeholder="(11) 99999-9999"
          />
        </Field>
        {error && (
          <p role="alert" className="md:col-span-2 text-caption text-danger">
            {error}
          </p>
        )}
        <ModalFooter className="md:col-span-2">
          <Button variant="ghost" type="button" onClick={onCancel}>Cancelar</Button>
          <Button variant="primary" type="submit" loading={create.isPending}>
            Criar e selecionar
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

// ─── Contact ─────────────────────────────────────────────────────────

function ContactQuickCreate({
  onCancel,
  onCreated,
  recursionDepth,
}: {
  onCancel: () => void;
  onCreated: (id: string, name: string) => void;
  recursionDepth: number;
}) {
  const { toast } = useToast();
  const companies = trpc.companies.list.useQuery({ page: 1, pageSize: 100 });
  const roles = trpc.contactRoles.list.useQuery({ includeInactive: false });
  const [form, setForm] = React.useState({
    fullName: '',
    email: '',
    companyId: '',
    contactRoleId: '',
  });
  const [error, setError] = React.useState<string | null>(null);
  const create = trpc.contacts.create.useMutation({
    onSuccess: (data) => {
      toast({ kind: 'success', title: `${data.fullName} adicionado como contato.` });
      onCreated(data.id, data.fullName);
    },
    onError: (e) => setError(e.message),
  });
  const allowRecursion = recursionDepth < 1;

  return (
    <Modal
      open
      onClose={onCancel}
      title={recursionDepth > 0 ? 'Novo contato › Nova empresa' : 'Novo contato'}
      description="Mínimo viável. Detalhes na tela de contatos."
      size="md"
    >
      <form
        className="grid md:grid-cols-2 gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          create.mutate({
            fullName: form.fullName,
            email: form.email,
            companyId: form.companyId || null,
            relationshipType: ContactRelationshipType.CLIENTE,
          });
        }}
      >
        <Field label="Nome completo" required>
          <Input
            required
            autoFocus
            value={form.fullName}
            onChange={(e) => setForm({ ...form, fullName: e.target.value })}
          />
        </Field>
        <Field label="E-mail" required>
          <Input
            required
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </Field>
        <Field label="Empresa" className="md:col-span-2">
          <div className="flex items-center gap-2">
            <Select
              className="flex-1"
              value={form.companyId}
              onChange={(e) => setForm({ ...form, companyId: e.target.value })}
            >
              <option value="">—</option>
              {companies.data?.rows.map((c) => (
                <option key={c.id} value={c.id}>{c.razaoSocial}</option>
              ))}
            </Select>
            {allowRecursion && (
              <QuickCreateTrigger
                entity="company"
                triggerLabel="+ Nova"
                onCreated={(id) => {
                  setForm((cur) => ({ ...cur, companyId: id }));
                  companies.refetch();
                }}
              />
            )}
          </div>
        </Field>
        <Field label="Cargo">
          <Select
            value={form.contactRoleId}
            onChange={(e) => setForm({ ...form, contactRoleId: e.target.value })}
          >
            <option value="">—</option>
            {roles.data?.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </Select>
        </Field>
        {error && (
          <p role="alert" className="md:col-span-2 text-caption text-danger">
            {error}
          </p>
        )}
        <ModalFooter className="md:col-span-2">
          <Button variant="ghost" type="button" onClick={onCancel}>Cancelar</Button>
          <Button variant="primary" type="submit" loading={create.isPending}>
            Criar e selecionar
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

// ─── Product ─────────────────────────────────────────────────────────

function ProductQuickCreate({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (id: string, name: string) => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = React.useState({
    name: '',
    type: ProductType.ALOCACAO as ProductType,
    sku: '',
  });
  const [error, setError] = React.useState<string | null>(null);
  const create = trpc.products.create.useMutation({
    onSuccess: (data) => {
      toast({ kind: 'success', title: `${data.name} adicionado ao catálogo.` });
      onCreated(data.id, data.name);
    },
    onError: (e) => setError(e.message),
  });

  return (
    <Modal
      open
      onClose={onCancel}
      title="Novo produto"
      description="Itens mínimos. Margem e descrição em /admin/products."
      size="sm"
    >
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          create.mutate({
            name: form.name,
            type: form.type,
            sku: form.sku || null,
            minMarginPct: 0,
            active: true,
          });
        }}
      >
        <Field label="Nome" required>
          <Input
            required
            autoFocus
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </Field>
        <Field label="Tipo">
          <Select
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value as ProductType })}
          >
            {Object.values(ProductType).map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </Select>
        </Field>
        <Field label="SKU">
          <Input
            value={form.sku}
            onChange={(e) => setForm({ ...form, sku: e.target.value })}
            maxLength={32}
          />
        </Field>
        {error && <p role="alert" className="text-caption text-danger">{error}</p>}
        <ModalFooter>
          <Button variant="ghost" type="button" onClick={onCancel}>Cancelar</Button>
          <Button variant="primary" type="submit" loading={create.isPending}>
            Criar e selecionar
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
