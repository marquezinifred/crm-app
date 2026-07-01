'use client';

import { useMemo, useState } from 'react';
import { trpc } from '@/lib/trpc/client';
import { friendlyTrpcError } from '@/lib/trpc/error-format';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { AlertDialog } from '@/components/ui/alert-dialog';
import { useToast } from '@/components/ui/toast';

/**
 * /admin/email-inbound — Sprint 6 (email) + Sprint 15D (forms de captura).
 *
 * 2 tabs:
 *   - E-mails recebidos → config do slug + como usar (Sprint 6)
 *   - Forms de captura → webhook secret + notify + blacklist + histórico
 */
export default function EmailInboundConfigPage() {
  return (
    <main className="mx-auto max-w-3xl p-6">
      <PageHeader
        title="Captura de leads"
        description="Configure os canais pelos quais leads inbound chegam automaticamente ao CRM: e-mail dedicado e webhook custom."
      />
      <Tabs defaultValue="email">
        <TabsList>
          <TabsTrigger value="email">E-mail inbound</TabsTrigger>
          <TabsTrigger value="forms">Forms de captura</TabsTrigger>
          <TabsTrigger value="history">Histórico</TabsTrigger>
        </TabsList>

        <TabsContent value="email">
          <EmailTab />
        </TabsContent>

        <TabsContent value="forms">
          <FormsTab />
        </TabsContent>

        <TabsContent value="history">
          <HistoryTab />
        </TabsContent>
      </Tabs>
    </main>
  );
}

// ═════════════════════════════════════════════════════════════════
// TAB 1 — E-mail inbound (Sprint 6 preservado)
// ═════════════════════════════════════════════════════════════════

function EmailTab() {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.adminEmail.getSlug.useQuery();
  const [slug, setSlug] = useState('');
  const setSlugMut = trpc.adminEmail.setSlug.useMutation({
    onSuccess: () => {
      setSlug('');
      utils.adminEmail.getSlug.invalidate();
    },
  });
  const regenMut = trpc.adminEmail.regenerateSlug.useMutation({
    onSuccess: () => utils.adminEmail.getSlug.invalidate(),
  });
  const [regenOpen, setRegenOpen] = useState(false);

  if (isLoading || !data) return <p className="text-sm text-text-2">Carregando…</p>;

  return (
    <>
      {data.fullAddress ? (
        <section className="mb-6 rounded-lg border border-border bg-card p-4">
          <p className="mb-2 text-xs font-medium uppercase text-text-1">Endereço ativo</p>
          <code className="block break-all rounded bg-hover p-3 text-sm">
            {data.fullAddress}
          </code>
          <div className="mt-3 flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => navigator.clipboard.writeText(data.fullAddress!)}
            >
              Copiar
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={regenMut.isPending}
              onClick={() => setRegenOpen(true)}
            >
              Regenerar
            </Button>
          </div>
          <AlertDialog
            open={regenOpen}
            onCancel={() => setRegenOpen(false)}
            title="Regenerar endereço?"
            description="O endereço atual será invalidado. Configurações no seu provedor (Postmark, Resend) precisam ser atualizadas."
            confirmLabel="Regenerar"
            tone="danger"
            onConfirm={() => {
              regenMut.mutate();
              setRegenOpen(false);
            }}
          />
        </section>
      ) : (
        <section className="mb-6 rounded-lg border border-warning bg-warning-bg p-4">
          <p className="mb-2 text-sm text-warning-text">
            Sem endereço inbound. Defina um slug abaixo para começar a receber e-mails no CRM.
          </p>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (/^[a-z0-9-]{4,40}$/.test(slug)) setSlugMut.mutate({ slug });
            }}
          >
            <input
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase())}
              placeholder="meu-tenant"
              className="input flex-1"
            />
            <Button type="submit" disabled={setSlugMut.isPending}>Salvar</Button>
          </form>
          {setSlugMut.error && (
            <p className="mt-2 text-sm text-danger">{friendlyTrpcError(setSlugMut.error)}</p>
          )}
        </section>
      )}

      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-text-1">
          Como usar
        </h2>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-text-1">
          <li>Configure este endereço como destino do webhook inbound no seu provedor (Postmark ou Resend).</li>
          <li>Encaminhe ou envie e-mails para este endereço — o CRM detecta o tenant pelo slug.</li>
          <li>
            Pra vincular direto a uma oportunidade, inclua{' '}
            <code className="rounded bg-hover px-1">#{'<id-da-oportunidade>'}</code> no assunto.
          </li>
          <li>Sem isso, a IA infere pelo contato; falhando, o item fica em /inbox pra revisão.</li>
        </ol>
      </section>
    </>
  );
}

// ═════════════════════════════════════════════════════════════════
// TAB 2 — Forms de captura (Sprint 15D)
// ═════════════════════════════════════════════════════════════════

function FormsTab() {
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const { data: config, isLoading } = trpc.inbound.getConfig.useQuery();
  const usersQuery = trpc.users.list.useQuery({});

  const [webhookEnabled, setWebhookEnabled] = useState<boolean | null>(null);
  const [notifyOnArrival, setNotifyOnArrival] = useState<boolean | null>(null);
  const [notifyUserIds, setNotifyUserIds] = useState<string[] | null>(null);
  const [blacklistText, setBlacklistText] = useState<string | null>(null);
  const [regenOpen, setRegenOpen] = useState(false);

  const update = trpc.inbound.updateConfig.useMutation({
    onSuccess: () => {
      toast({ kind: 'success', title: 'Configuração salva.' });
      utils.inbound.getConfig.invalidate();
    },
    onError: (err) =>
      toast({ kind: 'error', title: 'Erro ao salvar.', description: friendlyTrpcError(err) }),
  });

  const regen = trpc.inbound.regenerateWebhookSecret.useMutation({
    onSuccess: () => {
      toast({ kind: 'success', title: 'Novo secret gerado.', description: 'Atualize onde estiver configurado.' });
      utils.inbound.getConfig.invalidate();
    },
    onError: (err) =>
      toast({ kind: 'error', title: 'Erro ao regenerar.', description: friendlyTrpcError(err) }),
  });

  // Estado efetivo — usa override local se houver, senão do servidor
  const effectiveWebhookEnabled =
    webhookEnabled ?? config?.webhookEnabled ?? true;
  const effectiveNotify = notifyOnArrival ?? config?.notifyOnArrival ?? true;
  const effectiveNotifyIds = notifyUserIds ?? config?.notifyUserIds ?? [];
  const effectiveBlacklist = blacklistText ?? (config?.blacklistDomains ?? []).join('\n');

  if (isLoading) return <p className="text-sm text-text-2">Carregando…</p>;

  const webhookUrl =
    typeof window !== 'undefined' && config?.webhookSecret
      ? `${window.location.origin}/api/v1/inbound/lead?secret=${config.webhookSecret}`
      : null;

  const handleSave = () => {
    const blacklist = effectiveBlacklist
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    update.mutate({
      webhookEnabled: effectiveWebhookEnabled,
      notifyOnArrival: effectiveNotify,
      notifyUserIds: effectiveNotifyIds,
      blacklistDomains: blacklist,
    });
  };

  return (
    <div className="space-y-6">
      {/* Webhook */}
      <section className="rounded-lg border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-text-1">Webhook</h2>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={effectiveWebhookEnabled}
              onChange={(e) => setWebhookEnabled(e.target.checked)}
            />
            Habilitado
          </label>
        </div>

        {config?.webhookSecret ? (
          <div>
            <p className="mb-1 text-xs font-medium uppercase text-text-2">URL do endpoint</p>
            <code className="block break-all rounded bg-hover p-3 text-xs">{webhookUrl}</code>
            <div className="mt-3 flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => webhookUrl && navigator.clipboard.writeText(webhookUrl)}
              >
                Copiar
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setRegenOpen(true)}
              >
                Regenerar secret
              </Button>
            </div>
          </div>
        ) : (
          <div>
            <p className="text-sm text-text-2">
              Nenhum secret configurado ainda. Gere um pra receber leads via webhook.
            </p>
            <Button
              type="button"
              variant="primary"
              size="sm"
              className="mt-3"
              onClick={() => regen.mutate()}
              disabled={regen.isPending}
            >
              Gerar secret
            </Button>
          </div>
        )}
        <AlertDialog
          open={regenOpen}
          onCancel={() => setRegenOpen(false)}
          title="Regenerar secret?"
          description="O secret atual será invalidado imediatamente. Requisições com o valor antigo passam a retornar 401."
          confirmLabel="Regenerar"
          tone="danger"
          onConfirm={() => {
            regen.mutate();
            setRegenOpen(false);
          }}
        />
      </section>

      {/* Notificação */}
      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-1">Notificação</h2>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={effectiveNotify}
            onChange={(e) => setNotifyOnArrival(e.target.checked)}
          />
          Notificar quando chegar lead novo
        </label>

        {effectiveNotify && (
          <div className="mt-3">
            <p className="mb-1.5 text-xs font-medium uppercase text-text-2">Destinatários</p>
            <p className="mb-2 text-xs text-text-3">
              Sem seleção: todos os usuários com role &ldquo;Gestor de Inbound&rdquo; recebem.
            </p>
            <UserPicker
              users={usersQuery.data ?? []}
              selectedIds={effectiveNotifyIds}
              onChange={setNotifyUserIds}
            />
          </div>
        )}
      </section>

      {/* Blacklist */}
      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-1">
          Domínios bloqueados
        </h2>
        <p className="mb-2 text-xs text-text-3">
          Um por linha. Aceita <code>spam.com</code> (domínio inteiro), <code>@evil.com</code> (sufixo) ou
          <code>conhecido@abuse.com</code> (endereço completo). Leads desses endereços vão pra revisão manual.
        </p>
        <textarea
          value={effectiveBlacklist}
          onChange={(e) => setBlacklistText(e.target.value)}
          rows={4}
          className="input font-mono text-sm"
          placeholder="spam.com&#10;@evil.example.com"
        />
      </section>

      <div className="flex justify-end">
        <Button type="button" variant="primary" onClick={handleSave} disabled={update.isPending}>
          {update.isPending ? 'Salvando…' : 'Salvar configuração'}
        </Button>
      </div>

      <section className="rounded-lg border border-border bg-card p-4 text-xs text-text-2">
        <h3 className="mb-2 text-sm font-semibold text-text-1">Como usar</h3>
        <ol className="list-decimal space-y-1.5 pl-5">
          <li>Copie a URL do webhook acima e configure no seu form provider (Zapier, n8n, RD Station, etc).</li>
          <li>Envie JSON com pelo menos <code className="rounded bg-hover px-1">contact.email</code> ou <code className="rounded bg-hover px-1">company.cnpj</code>.</li>
          <li>Leads viram opportunity em estágio PROSPECT sem responsável, esperando alocação em /inbox/prospects.</li>
        </ol>
      </section>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════
// TAB 3 — Histórico
// ═════════════════════════════════════════════════════════════════

function HistoryTab() {
  const historyQuery = trpc.inbound.historyList.useQuery({ take: 30 });
  const rejectedQuery = trpc.inbound.rejectedList.useQuery({ take: 30 });

  const combined = useMemo(() => {
    const created = (historyQuery.data ?? []).map((o) => ({
      kind: 'created' as const,
      id: o.id,
      title: o.title,
      subtitle: o.clientCompany.razaoSocial,
      receivedAt: o.inboundReceivedAt,
      source: o.inboundSource,
      confidence: o.inboundConfidence ? Number(o.inboundConfidence) : null,
      status: o.status,
      stage: o.stage,
      ownerName: o.owner?.fullName ?? null,
    }));
    const rejected = (rejectedQuery.data ?? []).map((r) => ({
      kind: 'rejected' as const,
      id: r.id,
      title: r.reason,
      subtitle: `Fonte: ${r.source}`,
      receivedAt: r.receivedAt,
      source: r.source,
      confidence: r.confidence ? Number(r.confidence) : null,
      status: r.status,
      stage: null,
      ownerName: null,
    }));
    return [...created, ...rejected].sort(
      (a, b) => (b.receivedAt?.getTime() ?? 0) - (a.receivedAt?.getTime() ?? 0),
    );
  }, [historyQuery.data, rejectedQuery.data]);

  if (historyQuery.isLoading || rejectedQuery.isLoading) {
    return <p className="text-sm text-text-2">Carregando…</p>;
  }

  if (combined.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-text-2">
        Nenhum lead recebido ainda. Configure o webhook na tab &ldquo;Forms de captura&rdquo; e envie um teste.
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {combined.map((item) => (
        <li
          key={`${item.kind}:${item.id}`}
          className="rounded-lg border border-border bg-card p-3 text-sm"
        >
          <div className="mb-1 flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="font-medium text-text-1">{item.title}</p>
              <p className="text-xs text-text-2">{item.subtitle}</p>
            </div>
            <div className="flex items-center gap-2 text-xs">
              {item.kind === 'created' ? (
                <Badge variant="success">Criada · {item.stage}</Badge>
              ) : (
                <Badge variant="danger">Rejeitado · {item.status}</Badge>
              )}
              {item.confidence !== null && (
                <span className="text-text-3 tabular-nums">
                  {(item.confidence * 100).toFixed(0)}%
                </span>
              )}
              {item.receivedAt && (
                <span className="text-text-3">
                  {new Date(item.receivedAt).toLocaleDateString('pt-BR')}
                </span>
              )}
            </div>
          </div>
          {item.kind === 'created' && item.ownerName && (
            <p className="text-xs text-text-3">Alocado a {item.ownerName}</p>
          )}
        </li>
      ))}
    </ul>
  );
}

// ═════════════════════════════════════════════════════════════════
// UserPicker — multi-select de usuários pra notificação
// ═════════════════════════════════════════════════════════════════

interface UserPickerProps {
  users: Array<{ id: string; fullName: string; role: string }>;
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}
function UserPicker({ users, selectedIds, onChange }: UserPickerProps) {
  const toggle = (id: string) => {
    if (selectedIds.includes(id)) onChange(selectedIds.filter((x) => x !== id));
    else onChange([...selectedIds, id]);
  };
  if (users.length === 0) {
    return <p className="text-xs text-text-3">Sem usuários no tenant.</p>;
  }
  return (
    <div className="max-h-40 overflow-y-auto rounded border border-border">
      {users.map((u) => (
        <label
          key={u.id}
          className="flex cursor-pointer items-center gap-2 border-b border-border px-2 py-1.5 text-sm last:border-b-0 hover:bg-hover"
        >
          <input
            type="checkbox"
            checked={selectedIds.includes(u.id)}
            onChange={() => toggle(u.id)}
          />
          <span className="flex-1">{u.fullName}</span>
          <span className="text-xs text-text-3">{u.role}</span>
        </label>
      ))}
    </div>
  );
}
