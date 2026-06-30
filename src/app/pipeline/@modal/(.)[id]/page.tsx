'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { trpc } from '@/lib/trpc/client';
import { Sheet, SheetHeader, SheetBody } from '@/components/ui/sheet';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Avatar } from '@/components/ui/avatar';
import { useIsMobile } from '@/lib/utils/hooks';
import { formatBRL, formatBRLCompact, formatRelativeDate } from '@/lib/utils/format';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@/server/trpc/routers/_app';

type OpportunityDetail = inferRouterOutputs<AppRouter>['opportunities']['byId'];

const STAGE_BADGE_VARIANT: Record<string, 'default' | 'primary' | 'info' | 'warning' | 'success'> = {
  PROSPECT: 'default',
  LEAD: 'info',
  OPORTUNIDADE: 'primary',
  PROPOSTA: 'info',
  NEGOCIACAO: 'warning',
  ACEITE: 'success',
  CONTRATO: 'success',
};

/**
 * Intercepting route — Sprint 14.5 (spec §6.4).
 *
 * Renderiza DetailSheet via Radix Dialog (Sheet wrapper) com 4 tabs:
 * Visão Geral / Atividades / Documentos / Histórico. Mantém URL
 * `/pipeline/{id}`. Acesso direto cai em `[id]/page.tsx` full-page.
 */
export default function PipelineDetailSheet({ params }: { params: { id: string } }) {
  const router = useRouter();
  const isMobile = useIsMobile();
  const oppQ = trpc.opportunities.byId.useQuery({ id: params.id });

  const close = () => router.back();
  const opp = oppQ.data;

  return (
    <Sheet open onOpenChange={(v) => !v && close()} variant={isMobile ? 'bottom' : 'right'}>
      <SheetHeader
        title={opp?.title ?? 'Carregando...'}
        status={
          opp && (
            <Badge variant={STAGE_BADGE_VARIANT[opp.stage] ?? 'default'}>
              {opp.stage}
            </Badge>
          )
        }
        rightAction={
          <Link
            href={`/pipeline/${params.id}`}
            aria-label="Abrir página completa"
            title="Abrir página completa"
            className="flex h-8 w-8 items-center justify-center rounded text-text-2 hover:bg-hover hover:text-text-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M7 17L17 7M7 7h10v10" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
        }
        onClose={close}
      />
      <SheetBody className="p-0">
        {oppQ.isLoading && (
          <div className="px-5 py-4 space-y-3">
            <div className="skeleton h-6 w-3/4" />
            <div className="skeleton h-4 w-1/2" />
            <div className="skeleton h-24" />
          </div>
        )}
        {oppQ.error && (
          <p role="alert" className="px-5 py-4 text-body text-danger">
            {oppQ.error.message}
          </p>
        )}
        {opp && (
          <Tabs defaultValue="overview" className="px-5 pb-5">
            <TabsList className="sticky top-0 bg-card -mx-5 px-5 z-10">
              <TabsTrigger value="overview">Visão geral</TabsTrigger>
              <TabsTrigger value="activities">Atividades</TabsTrigger>
              <TabsTrigger value="documents">Documentos</TabsTrigger>
              <TabsTrigger value="history">Histórico</TabsTrigger>
            </TabsList>

            <TabsContent value="overview">
              <OverviewTab opp={opp} />
            </TabsContent>

            <TabsContent value="activities">
              <p className="text-body text-text-2">
                Use a página completa para inserir notas e ver a timeline detalhada.
              </p>
            </TabsContent>

            <TabsContent value="documents">
              <p className="text-body text-text-2">
                Anexos de propostas e contratos estão na página completa.
              </p>
            </TabsContent>

            <TabsContent value="history">
              <HistoryTab opp={opp} />
            </TabsContent>
          </Tabs>
        )}
      </SheetBody>
    </Sheet>
  );
}

function OverviewTab({ opp }: { opp: OpportunityDetail }) {
  const value = Number(opp.estimatedValue ?? 0);
  const company = opp.clientCompany?.nomeFantasia ?? opp.clientCompany?.razaoSocial;
  return (
    <dl className="grid grid-cols-2 gap-4 mt-2">
      <div className="col-span-2">
        <dt className="text-label text-text-3">Valor estimado</dt>
        <dd
          title={formatBRL(value)}
          className="font-mono tabular-nums text-h2 text-brand-accent mt-1"
        >
          {formatBRLCompact(value)}
        </dd>
      </div>
      {company && (
        <div className="col-span-2">
          <dt className="text-label text-text-3">Empresa</dt>
          <dd className="text-body text-text-1 mt-1">{company}</dd>
        </div>
      )}
      {opp.owner && (
        <div>
          <dt className="text-label text-text-3">Responsável</dt>
          <dd className="flex items-center gap-2 mt-1">
            <Avatar name={opp.owner.fullName} size="xs" />
            <span className="text-body text-text-1">{opp.owner.fullName}</span>
          </dd>
        </div>
      )}
      {opp.expectedCloseDate && (
        <div>
          <dt className="text-label text-text-3">Previsão</dt>
          <dd className="text-body text-text-1 mt-1">
            {formatRelativeDate(new Date(opp.expectedCloseDate))}
          </dd>
        </div>
      )}
      {opp.clientContact && (
        <div className="col-span-2">
          <dt className="text-label text-text-3">Contato principal</dt>
          <dd className="text-body text-text-1 mt-1">{opp.clientContact.fullName}</dd>
        </div>
      )}
    </dl>
  );
}

function HistoryTab({ opp }: { opp: OpportunityDetail }) {
  if (opp.stageHistory.length === 0) {
    return <p className="text-body text-text-2 mt-2">Sem mudanças de estágio ainda.</p>;
  }
  return (
    <ol className="mt-2 space-y-3">
      {opp.stageHistory.map((h) => (
        <li key={h.id} className="text-body">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-text-1">
              {h.fromStage ? `${h.fromStage} → ` : 'Criada em '}
              <strong>{h.toStage}</strong>
            </span>
            <span className="text-caption text-text-3 whitespace-nowrap">
              {formatRelativeDate(new Date(h.at))}
            </span>
          </div>
        </li>
      ))}
    </ol>
  );
}
