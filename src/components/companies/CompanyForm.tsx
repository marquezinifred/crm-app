'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CompanyType } from '@prisma/client';
import { trpc } from '@/lib/trpc/client';
import { Field } from '@/components/ui/field';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useDebouncedValue } from '@/lib/utils/hooks';
import { isValidCnpj, stripCnpj } from '@/lib/validators/cnpj';
import { lookupCnpj, type CnpjData, type CnpjLookupResult } from '@/lib/cnpj/lookup';
import { mergeCnpjAutofill } from '@/lib/cnpj/autofill';

/**
 * CompanyForm — sprint corretivo /companies (fix 404 ghost route) +
 * autofill BrasilAPI por CNPJ.
 *
 * Reusa tRPC procedures companies.create/update existentes.
 * Quando `companyId` é passado, carrega via byId e preenche o form
 * (e desliga o autofill — empresa já existe).
 */

const TYPE_LABEL: Record<CompanyType, string> = {
  CLIENT: 'Cliente',
  PARTNER: 'Parceiro',
  SUPPLIER: 'Fornecedor',
  OWN: 'Minha empresa',
};

interface FormState {
  type: CompanyType;
  razaoSocial: string;
  nomeFantasia: string;
  cnpj: string;
  country: string;
  state: string;
  city: string;
  website: string;
  email: string;
  phone: string;
  territoryId: string;
  segmentId: string;
  notes: string;
}

const EMPTY: FormState = {
  type: 'CLIENT',
  razaoSocial: '',
  nomeFantasia: '',
  cnpj: '',
  country: 'BR',
  state: '',
  city: '',
  website: '',
  email: '',
  phone: '',
  territoryId: '',
  segmentId: '',
  notes: '',
};

type LookupStatus =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ok'; data: CnpjData; preserved: string[] }
  | { kind: 'inactive'; data: CnpjData; situacao: string }
  | { kind: 'not-found' }
  | { kind: 'rate-limited' }
  | { kind: 'error'; message: string };

const FIELD_LABEL: Record<string, string> = {
  razaoSocial: 'Razão social',
  nomeFantasia: 'Nome fantasia',
  state: 'UF',
  city: 'Cidade',
  phone: 'Telefone',
};

export function CompanyForm({
  companyId,
  onSuccess,
  onCancel,
}: {
  companyId?: string;
  onSuccess?: (id: string) => void;
  onCancel?: () => void;
}) {
  const utils = trpc.useUtils();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [lookup, setLookup] = useState<LookupStatus>({ kind: 'idle' });
  const lookupAbort = useRef<AbortController | null>(null);
  const lastLookedUp = useRef<string | null>(null);

  const isEditMode = Boolean(companyId);

  const existing = trpc.companies.byId.useQuery(
    { id: companyId ?? '' },
    { enabled: isEditMode, staleTime: 0 },
  );
  const territories = trpc.territories.list.useQuery();
  const segments = trpc.segments.list.useQuery();

  useEffect(() => {
    if (existing.data) {
      const c = existing.data;
      setForm({
        type: c.type,
        razaoSocial: c.razaoSocial,
        nomeFantasia: c.nomeFantasia ?? '',
        cnpj: c.cnpj ?? '',
        country: c.country ?? 'BR',
        state: c.state ?? '',
        city: c.city ?? '',
        website: c.website ?? '',
        email: c.email ?? '',
        phone: c.phone ?? '',
        territoryId: c.territoryId ?? '',
        segmentId: c.segmentId ?? '',
        notes: c.notes ?? '',
      });
    }
  }, [existing.data]);

  const debouncedCnpj = useDebouncedValue(form.cnpj, 500);
  const cnpjDigits = useMemo(() => stripCnpj(debouncedCnpj), [debouncedCnpj]);

  const runLookup = useCallback(
    async (digits: string, currentForm: FormState) => {
      lookupAbort.current?.abort();
      const ctrl = new AbortController();
      lookupAbort.current = ctrl;

      setLookup({ kind: 'loading' });
      const result: CnpjLookupResult = await lookupCnpj(digits, { signal: ctrl.signal });
      if (ctrl.signal.aborted) return;

      if (result.status === 'ok' || result.status === 'inactive') {
        const { next, preserved } = mergeCnpjAutofill(currentForm, result.data);
        setForm(next);
        if (result.status === 'ok') {
          setLookup({
            kind: 'ok',
            data: result.data,
            preserved: preserved.map((k) => FIELD_LABEL[k] ?? k),
          });
        } else {
          setLookup({ kind: 'inactive', data: result.data, situacao: result.situacao });
        }
        return;
      }
      if (result.status === 'not-found') return setLookup({ kind: 'not-found' });
      if (result.status === 'rate-limited') return setLookup({ kind: 'rate-limited' });
      setLookup({ kind: 'error', message: result.message });
    },
    [],
  );

  useEffect(() => {
    if (isEditMode) return;
    if (cnpjDigits.length !== 14) {
      lookupAbort.current?.abort();
      if (lookup.kind !== 'idle') setLookup({ kind: 'idle' });
      lastLookedUp.current = null;
      return;
    }
    if (!isValidCnpj(cnpjDigits)) {
      lookupAbort.current?.abort();
      setLookup({ kind: 'error', message: 'CNPJ inválido (dígitos verificadores)' });
      lastLookedUp.current = null;
      return;
    }
    if (lastLookedUp.current === cnpjDigits) return;
    lastLookedUp.current = cnpjDigits;
    void runLookup(cnpjDigits, form);
    // form deliberadamente fora das deps: queremos rodar quando o CNPJ
    // muda, não a cada keystroke nos outros campos.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cnpjDigits, isEditMode, runLookup]);

  useEffect(() => {
    return () => lookupAbort.current?.abort();
  }, []);

  const retryLookup = () => {
    lastLookedUp.current = null;
    if (cnpjDigits.length === 14 && isValidCnpj(cnpjDigits)) {
      void runLookup(cnpjDigits, form);
    }
  };

  const create = trpc.companies.create.useMutation({
    onSuccess: (created) => {
      utils.companies.list.invalidate();
      onSuccess?.(created.id);
    },
    onError: (e) => setError(e.message),
  });
  const update = trpc.companies.update.useMutation({
    onSuccess: () => {
      utils.companies.list.invalidate();
      if (companyId) utils.companies.byId.invalidate({ id: companyId });
      onSuccess?.(companyId!);
    },
    onError: (e) => setError(e.message),
  });

  const busy = create.isPending || update.isPending;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const payload = {
      type: form.type,
      razaoSocial: form.razaoSocial.trim(),
      nomeFantasia: form.nomeFantasia.trim() || null,
      cnpj: form.cnpj.replace(/\D/g, '') || null,
      country: form.country.trim() || 'BR',
      state: form.state.trim() || null,
      city: form.city.trim() || null,
      website: form.website.trim() || null,
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      territoryId: form.territoryId || null,
      segmentId: form.segmentId || null,
      notes: form.notes.trim() || null,
    };
    if (companyId) update.mutate({ id: companyId, ...payload });
    else create.mutate(payload);
  }

  if (companyId && existing.isLoading) {
    return <p className="text-body text-text-2">Carregando dados da empresa…</p>;
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div className="grid md:grid-cols-2 gap-4">
        <Field label="Tipo" required>
          <Select
            value={form.type}
            onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as CompanyType }))}
          >
            {Object.entries(TYPE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </Select>
        </Field>
        <Field label="CNPJ" helper="Apenas dígitos ou no formato 00.000.000/0000-00">
          <Input
            value={form.cnpj}
            onChange={(e) => setForm((f) => ({ ...f, cnpj: e.target.value }))}
            placeholder="00.000.000/0000-00"
          />
        </Field>
        {!isEditMode && <LookupStatusLine status={lookup} onRetry={retryLookup} />}
        <Field label="Razão social" required className="md:col-span-2">
          <Input
            required
            value={form.razaoSocial}
            onChange={(e) => setForm((f) => ({ ...f, razaoSocial: e.target.value }))}
          />
        </Field>
        <Field label="Nome fantasia" className="md:col-span-2">
          <Input
            value={form.nomeFantasia}
            onChange={(e) => setForm((f) => ({ ...f, nomeFantasia: e.target.value }))}
          />
        </Field>
        <Field label="País">
          <Input
            value={form.country}
            onChange={(e) => setForm((f) => ({ ...f, country: e.target.value.toUpperCase().slice(0, 2) }))}
            placeholder="BR"
          />
        </Field>
        <Field label="UF">
          <Input
            value={form.state}
            onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))}
            placeholder="SP"
          />
        </Field>
        <Field label="Cidade" className="md:col-span-2">
          <Input
            value={form.city}
            onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
          />
        </Field>
        <Field label="Território">
          <Select
            value={form.territoryId}
            onChange={(e) => setForm((f) => ({ ...f, territoryId: e.target.value }))}
          >
            <option value="">—</option>
            {territories.data?.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Segmento">
          <Select
            value={form.segmentId}
            onChange={(e) => setForm((f) => ({ ...f, segmentId: e.target.value }))}
          >
            <option value="">—</option>
            {segments.data?.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="E-mail">
          <Input
            type="email"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
          />
        </Field>
        <Field label="Telefone">
          <Input
            type="tel"
            value={form.phone}
            onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            placeholder="(11) 99999-9999"
          />
        </Field>
        <Field label="Site" className="md:col-span-2">
          <Input
            value={form.website}
            onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))}
            placeholder="https://exemplo.com.br"
          />
        </Field>
        <Field label="Notas" className="md:col-span-2">
          <Textarea
            rows={3}
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          />
        </Field>
      </div>

      {error && (
        <p role="alert" className="text-caption text-danger">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2 pt-2">
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
        )}
        <Button type="submit" variant="primary" loading={busy}>
          {companyId ? 'Salvar alterações' : 'Criar empresa'}
        </Button>
      </div>
    </form>
  );
}

function LookupStatusLine({
  status,
  onRetry,
}: {
  status: LookupStatus;
  onRetry: () => void;
}) {
  if (status.kind === 'idle') return null;

  return (
    <div className="md:col-span-2 -mt-2" aria-live="polite">
      {status.kind === 'loading' && (
        <p className="text-caption text-text-2 inline-flex items-center gap-2">
          <Spinner /> Buscando dados na Receita Federal…
        </p>
      )}

      {status.kind === 'ok' && (
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="success" dot>Empresa encontrada</Badge>
          {status.data.cnaeCode && (
            <Badge variant="primary" title={status.data.cnaeName}>
              CNAE {status.data.cnaeCode}
            </Badge>
          )}
          {status.preserved.length > 0 && (
            <p className="text-caption text-text-3 w-full">
              Mantivemos o que você já tinha digitado em:{' '}
              <strong>{status.preserved.join(', ')}</strong>.
            </p>
          )}
          {status.data.cnaeName && (
            <p className="text-caption text-text-3 w-full">{status.data.cnaeName}</p>
          )}
        </div>
      )}

      {status.kind === 'inactive' && (
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="warning" dot>{status.situacao}</Badge>
          <p className="text-caption text-warning-text w-full">
            Esta empresa está {status.situacao.toLowerCase()} na Receita. Confirme
            antes de cadastrar.
          </p>
        </div>
      )}

      {status.kind === 'not-found' && (
        <p className="text-caption text-warning-text">
          CNPJ não encontrado na Receita. Você pode cadastrar manualmente.
        </p>
      )}

      {status.kind === 'rate-limited' && (
        <p className="text-caption text-text-2">
          Limite de buscas atingido. Aguarde 1 min e tente novamente — você
          pode preencher manualmente nesse meio tempo.
        </p>
      )}

      {status.kind === 'error' && (
        <p className="text-caption text-danger inline-flex items-center gap-2">
          Não foi possível buscar ({status.message}).
          <button
            type="button"
            onClick={onRetry}
            className="underline text-brand-primary-light"
          >
            Tentar novamente
          </button>
        </p>
      )}
    </div>
  );
}

function Spinner() {
  return (
    <span
      className="inline-block h-4 w-4 rounded-full border-2 border-text-3 border-t-transparent animate-spin"
      aria-hidden="true"
    />
  );
}
