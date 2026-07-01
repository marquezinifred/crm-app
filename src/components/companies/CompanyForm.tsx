'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CompanyType } from '@prisma/client';
import { trpc } from '@/lib/trpc/client';
import { friendlyTrpcError } from '@/lib/trpc/error-format';
import { Field } from '@/components/ui/field';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { useDebouncedValue } from '@/lib/utils/hooks';
import { isValidCnpj, stripCnpj } from '@/lib/validators/cnpj';
import { lookupCnpj, type CnpjData, type CnpjLookupResult } from '@/lib/cnpj/lookup';
import { mergeCnpjAutofill } from '@/lib/cnpj/autofill';
import { lookupCep } from '@/lib/cep/lookup';
import { ESTADOS_BR, PAISES, useCidadesByUF } from '@/lib/data/brasil';
import {
  formatCNPJ,
  unformatCNPJ,
  formatCEP,
  unformatCEP,
} from '@/lib/utils/format';

/**
 * CompanyForm — Sprint 15C.
 *
 * Mantém: auto-fill BrasilAPI por CNPJ (Sprint 13 corretivo).
 *
 * Adiciona:
 *  - Máscara visual CNPJ + máscara visual CEP
 *  - Auto-fill BrasilAPI por CEP (preenche logradouro/bairro/UF/cidade
 *    sem sobrescrever o que o usuário já digitou)
 *  - País como Select (default Brasil) + UF como Select dos 27 + Cidade
 *    como Combobox IBGE (cache perpétuo da sessão)
 *  - Campos novos: cep, logradouro, numero, complemento, bairro
 *  - Setor configurável (industries)
 *  - Toast de sucesso com voz Venzo
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
  cep: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  state: string;
  city: string;
  website: string;
  email: string;
  phone: string;
  territoryId: string;
  segmentId: string;
  industryId: string;
  notes: string;
}

const EMPTY: FormState = {
  type: 'CLIENT',
  razaoSocial: '',
  nomeFantasia: '',
  cnpj: '',
  country: 'BR',
  cep: '',
  logradouro: '',
  numero: '',
  complemento: '',
  bairro: '',
  state: '',
  city: '',
  website: '',
  email: '',
  phone: '',
  territoryId: '',
  segmentId: '',
  industryId: '',
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
  const { toast } = useToast();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [lookup, setLookup] = useState<LookupStatus>({ kind: 'idle' });
  const lookupAbort = useRef<AbortController | null>(null);
  const lastLookedUp = useRef<string | null>(null);
  const cepAbort = useRef<AbortController | null>(null);
  const lastCep = useRef<string | null>(null);

  const isEditMode = Boolean(companyId);
  const isBrazil = form.country === 'BR';

  const existing = trpc.companies.byId.useQuery(
    { id: companyId ?? '' },
    { enabled: isEditMode, staleTime: 0 },
  );
  const territories = trpc.territories.list.useQuery();
  const segments = trpc.segments.list.useQuery();
  const industries = trpc.industries.list.useQuery({ includeInactive: false });
  const municipios = useCidadesByUF(isBrazil ? form.state : null);

  useEffect(() => {
    if (existing.data) {
      const c = existing.data;
      setForm({
        type: c.type,
        razaoSocial: c.razaoSocial,
        nomeFantasia: c.nomeFantasia ?? '',
        cnpj: c.cnpj ?? '',
        country: c.country ?? 'BR',
        cep: c.cep ?? '',
        logradouro: c.logradouro ?? '',
        numero: c.numero ?? '',
        complemento: c.complemento ?? '',
        bairro: c.bairro ?? '',
        state: c.state ?? '',
        city: c.city ?? '',
        website: c.website ?? '',
        email: c.email ?? '',
        phone: c.phone ?? '',
        territoryId: c.territoryId ?? '',
        segmentId: c.segmentId ?? '',
        industryId: c.industryId ?? '',
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cnpjDigits, isEditMode, runLookup]);

  // Sprint 15C — CEP auto-fill. Não sobrescreve campos preenchidos.
  const debouncedCep = useDebouncedValue(form.cep, 500);
  useEffect(() => {
    if (!isBrazil) return;
    const digits = unformatCEP(debouncedCep);
    if (digits.length !== 8) return;
    if (lastCep.current === digits) return;
    lastCep.current = digits;

    cepAbort.current?.abort();
    const ctrl = new AbortController();
    cepAbort.current = ctrl;

    void (async () => {
      const res = await lookupCep(digits, { signal: ctrl.signal });
      if (ctrl.signal.aborted) return;
      if (res.status !== 'ok') return;
      setForm((cur) => ({
        ...cur,
        logradouro: cur.logradouro || res.data.street,
        bairro: cur.bairro || res.data.neighborhood,
        state: cur.state || res.data.state,
        city: cur.city || res.data.city,
      }));
      toast({ kind: 'info', title: 'Endereço preenchido via CEP.' });
    })();
  }, [debouncedCep, isBrazil, toast]);

  useEffect(() => {
    return () => {
      lookupAbort.current?.abort();
      cepAbort.current?.abort();
    };
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
      toast({
        kind: 'success',
        title: `${created.razaoSocial} adicionada ao seu portfólio.`,
      });
      onSuccess?.(created.id);
    },
    onError: (e) => setError(friendlyTrpcError(e)),
  });
  const update = trpc.companies.update.useMutation({
    onSuccess: () => {
      utils.companies.list.invalidate();
      if (companyId) utils.companies.byId.invalidate({ id: companyId });
      toast({ kind: 'success', title: `Dados de ${form.razaoSocial} atualizados.` });
      onSuccess?.(companyId!);
    },
    onError: (e) => setError(friendlyTrpcError(e)),
  });

  const busy = create.isPending || update.isPending;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const payload = {
      type: form.type,
      razaoSocial: form.razaoSocial.trim(),
      nomeFantasia: form.nomeFantasia.trim() || null,
      cnpj: unformatCNPJ(form.cnpj) || null,
      country: form.country.trim() || 'BR',
      cep: unformatCEP(form.cep) || null,
      logradouro: form.logradouro.trim() || null,
      numero: form.numero.trim() || null,
      complemento: form.complemento.trim() || null,
      bairro: form.bairro.trim() || null,
      state: form.state.trim() || null,
      city: form.city.trim() || null,
      website: form.website.trim() || null,
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      territoryId: form.territoryId || null,
      segmentId: form.segmentId || null,
      industryId: form.industryId || null,
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
        <Field label="CNPJ" helper="Auto-fill via Receita Federal.">
          <Input
            value={formatCNPJ(form.cnpj)}
            onChange={(e) => setForm((f) => ({ ...f, cnpj: unformatCNPJ(e.target.value) }))}
            placeholder="00.000.000/0000-00"
            maxLength={18}
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

        {/* ─── Endereço ─────────────────────────────────────────── */}
        <Field label="País">
          <Select
            value={form.country}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                country: e.target.value,
                // Sai do Brasil → limpa cep/UF/cidade que dependem de IBGE
                ...(e.target.value !== 'BR'
                  ? { cep: '', state: '', city: '' }
                  : {}),
              }))
            }
          >
            {PAISES.map((p) => (
              <option key={p.code} value={p.code}>{p.nome}</option>
            ))}
          </Select>
        </Field>
        {isBrazil ? (
          <Field label="CEP" helper="Auto-fill BrasilAPI.">
            <Input
              value={formatCEP(form.cep)}
              onChange={(e) => setForm((f) => ({ ...f, cep: unformatCEP(e.target.value) }))}
              placeholder="00000-000"
              maxLength={9}
              inputMode="numeric"
            />
          </Field>
        ) : (
          <div />
        )}

        {isBrazil ? (
          <>
            <Field label="Logradouro">
              <Input
                value={form.logradouro}
                onChange={(e) => setForm((f) => ({ ...f, logradouro: e.target.value }))}
              />
            </Field>
            <Field label="Número">
              <Input
                value={form.numero}
                onChange={(e) => setForm((f) => ({ ...f, numero: e.target.value }))}
                placeholder="123"
                maxLength={20}
              />
            </Field>
            <Field label="Complemento">
              <Input
                value={form.complemento}
                onChange={(e) => setForm((f) => ({ ...f, complemento: e.target.value }))}
                placeholder="Sala 5"
              />
            </Field>
            <Field label="Bairro">
              <Input
                value={form.bairro}
                onChange={(e) => setForm((f) => ({ ...f, bairro: e.target.value }))}
              />
            </Field>
          </>
        ) : null}

        <Field label="UF">
          {isBrazil ? (
            <Select
              value={form.state}
              onChange={(e) =>
                setForm((f) => ({ ...f, state: e.target.value, city: '' }))
              }
            >
              <option value="">—</option>
              {ESTADOS_BR.map((s) => (
                <option key={s.uf} value={s.uf}>
                  {s.uf} — {s.nome}
                </option>
              ))}
            </Select>
          ) : (
            <Input
              value={form.state}
              onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))}
              placeholder="Estado/Província"
            />
          )}
        </Field>
        <Field
          label="Cidade"
          helper={
            isBrazil && form.state && municipios.isLoading
              ? 'Carregando municípios IBGE…'
              : undefined
          }
        >
          {isBrazil && form.state ? (
            <>
              <Input
                value={form.city}
                onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
                list="company-form-cidades"
                placeholder={
                  municipios.data?.length
                    ? `Digite ou escolha (${municipios.data.length} municípios)`
                    : undefined
                }
              />
              <datalist id="company-form-cidades">
                {municipios.data?.map((m) => (
                  <option key={m.id} value={m.nome} />
                ))}
              </datalist>
            </>
          ) : (
            <Input
              value={form.city}
              onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
            />
          )}
        </Field>

        {/* ─── Classificação ─────────────────────────────────────── */}
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
        <Field label="Setor (indústria)" className="md:col-span-2">
          <Select
            value={form.industryId}
            onChange={(e) => setForm((f) => ({ ...f, industryId: e.target.value }))}
          >
            <option value="">—</option>
            {industries.data?.map((i) => (
              <option key={i.id} value={i.id}>{i.name}</option>
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

      <div className="flex justify-end gap-2 pt-2 sticky bottom-0 bg-card -mx-6 px-6 py-3 border-t border-border">
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
