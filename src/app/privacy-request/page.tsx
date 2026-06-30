'use client';

import { useState } from 'react';
import { Field } from '@/components/ui/field';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

/**
 * Página pública /privacy-request — Sprint 11 + design Venzo Sprint 14.
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
        throw new Error(typeof data.error === 'string' ? data.error : 'Algo saiu errado ao registrar.');
      }
      setResult({ requestId: data.requestId!, dueAt: data.dueAt! });
      setState('done');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Algo saiu errado. Tente novamente.');
      setState('error');
    }
  }

  if (state === 'done' && result) {
    return (
      <main className="max-w-2xl mx-auto px-6 py-10 space-y-5">
        <h1 className="text-h1">Solicitação registrada</h1>
        <p className="text-body-lg text-text-2">
          Recebemos seu pedido. Conforme a LGPD, respondemos em até{' '}
          <strong className="text-text-1">15 dias</strong>.
        </p>
        <dl className="bg-card border border-border rounded-md p-4 space-y-3">
          <div>
            <dt className="text-caption text-text-3 uppercase tracking-wider">Protocolo</dt>
            <dd className="text-mono text-brand-primary-light">{result.requestId}</dd>
          </div>
          <div>
            <dt className="text-caption text-text-3 uppercase tracking-wider">Prazo final</dt>
            <dd className="text-body text-text-1">{new Date(result.dueAt).toLocaleDateString('pt-BR')}</dd>
          </div>
        </dl>
        <p className="text-caption text-text-3">
          Guarde o protocolo. Em caso de dúvida, encaminhe para o DPO informando esse número.
        </p>
      </main>
    );
  }

  return (
    <main className="max-w-2xl mx-auto px-6 py-10 space-y-6">
      <header>
        <h1 className="text-h1">Seus direitos (LGPD)</h1>
        <p className="text-body-lg text-text-2 mt-2">
          Solicite acesso, correção, eliminação ou portabilidade dos seus dados.
          Respondemos em até 15 dias corridos.
        </p>
      </header>

      <form onSubmit={submit} className="space-y-4 bg-card border border-border rounded-md p-5" noValidate>
        <Field label="Empresa (slug do tenant)" required>
          <Input
            required
            value={tenantSlug}
            onChange={(e) => setTenantSlug(e.target.value)}
            placeholder="ex: pena-commerce"
          />
        </Field>

        <Field label="Tipo de solicitação" required>
          <Select
            value={requestType}
            onChange={(e) => setRequestType(e.target.value as typeof TYPES[number]['value'])}
          >
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Seu e-mail" required>
          <Input
            type="email"
            required
            value={subjectEmail}
            onChange={(e) => setSubjectEmail(e.target.value)}
          />
        </Field>

        <Field label="Seu nome">
          <Input
            value={subjectName}
            onChange={(e) => setSubjectName(e.target.value)}
          />
        </Field>

        <Field label="Detalhes" helper="Descreva o que você precisa (até 2000 caracteres).">
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            maxLength={2000}
          />
        </Field>

        {state === 'error' && (
          <p role="alert" className="text-caption text-danger">{errorMessage}</p>
        )}

        <Button type="submit" loading={state === 'submitting'} variant="primary">
          {state === 'submitting' ? 'Enviando...' : 'Enviar solicitação'}
        </Button>
      </form>
    </main>
  );
}
