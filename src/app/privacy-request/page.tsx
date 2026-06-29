'use client';

import { useState } from 'react';

/**
 * Página pública /privacy-request — Sprint 11.
 *
 * Permite que qualquer titular submeta solicitação LGPD §18 sem auth.
 * Conta com rate limit no endpoint /api/v1/privacy-request (10/min/ip).
 * SLA ANPD: 15 dias entre submissão e conclusão.
 */

const TYPES = [
  { value: 'ACCESS', label: 'Acesso aos meus dados' },
  { value: 'CORRECTION', label: 'Correção de dados' },
  { value: 'DELETION', label: 'Eliminação / anonimização' },
  { value: 'PORTABILITY', label: 'Portabilidade (exportar dados)' },
  { value: 'OBJECTION', label: 'Oposição ao tratamento' },
] as const;

export default function PrivacyRequestPage() {
  const [tenantSlug, setTenantSlug] = useState('');
  const [requestType, setRequestType] = useState<typeof TYPES[number]['value']>('ACCESS');
  const [subjectEmail, setSubjectEmail] = useState('');
  const [subjectName, setSubjectName] = useState('');
  const [description, setDescription] = useState('');
  const [state, setState] = useState<'idle' | 'submitting' | 'done' | 'error'>('idle');
  const [result, setResult] = useState<{ requestId: string; dueAt: string } | null>(null);
  const [errorMessage, setErrorMessage] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState('submitting');
    setErrorMessage('');
    try {
      const res = await fetch('/api/v1/privacy-request', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tenantSlug,
          requestType,
          subjectEmail,
          subjectName: subjectName || undefined,
          description: description || undefined,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; requestId?: string; dueAt?: string; error?: unknown };
      if (!res.ok || !data.ok) {
        throw new Error(typeof data.error === 'string' ? data.error : 'Falha ao registrar solicitação');
      }
      setResult({ requestId: data.requestId!, dueAt: data.dueAt! });
      setState('done');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Erro desconhecido');
      setState('error');
    }
  }

  if (state === 'done' && result) {
    return (
      <main className="max-w-2xl mx-auto p-6 md:p-10 space-y-4">
        <h1 className="text-2xl font-semibold">Solicitação registrada</h1>
        <p className="text-neutral-700">
          Recebemos sua solicitação. Conforme a LGPD, responderemos em até{' '}
          <strong>15 dias</strong>.
        </p>
        <dl className="bg-neutral-50 border rounded-md p-4 text-sm space-y-2">
          <div>
            <dt className="text-neutral-500">Protocolo</dt>
            <dd className="font-mono">{result.requestId}</dd>
          </div>
          <div>
            <dt className="text-neutral-500">Prazo final</dt>
            <dd>{new Date(result.dueAt).toLocaleDateString('pt-BR')}</dd>
          </div>
        </dl>
        <p className="text-sm text-neutral-500">
          Guarde o número de protocolo. Em caso de dúvida, encaminhe para o nosso
          DPO informando o protocolo.
        </p>
      </main>
    );
  }

  return (
    <main className="max-w-2xl mx-auto p-6 md:p-10 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Direitos do titular (LGPD)</h1>
        <p className="text-neutral-600 mt-1">
          Solicite acesso, correção, eliminação ou portabilidade dos seus dados.
          Respondemos em até 15 dias corridos.
        </p>
      </header>

      <form onSubmit={submit} className="space-y-4">
        <label className="block">
          <span className="text-sm font-medium">Empresa (slug do tenant)</span>
          <input
            required
            value={tenantSlug}
            onChange={(e) => setTenantSlug(e.target.value)}
            className="mt-1 w-full border rounded-md px-3 py-2"
            placeholder="ex: pena-commerce"
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium">Tipo de solicitação</span>
          <select
            value={requestType}
            onChange={(e) => setRequestType(e.target.value as typeof TYPES[number]['value'])}
            className="mt-1 w-full border rounded-md px-3 py-2 bg-white"
          >
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-sm font-medium">Seu e-mail</span>
          <input
            type="email"
            required
            value={subjectEmail}
            onChange={(e) => setSubjectEmail(e.target.value)}
            className="mt-1 w-full border rounded-md px-3 py-2"
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium">Seu nome (opcional)</span>
          <input
            value={subjectName}
            onChange={(e) => setSubjectName(e.target.value)}
            className="mt-1 w-full border rounded-md px-3 py-2"
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium">Detalhes (opcional)</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            className="mt-1 w-full border rounded-md px-3 py-2"
            maxLength={2000}
          />
        </label>

        {state === 'error' && (
          <p className="text-sm text-red-600">{errorMessage}</p>
        )}

        <button
          type="submit"
          disabled={state === 'submitting'}
          className="px-4 py-2 rounded-md bg-brand text-white hover:opacity-90 disabled:opacity-50"
        >
          {state === 'submitting' ? 'Enviando...' : 'Enviar solicitação'}
        </button>
      </form>
    </main>
  );
}
