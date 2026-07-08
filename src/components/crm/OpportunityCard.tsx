'use client';

import Link from 'next/link';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils/cn';
import { formatBRL, formatBRLCompact, formatRelativeDate } from '@/lib/utils/format';

/**
 * Card de oportunidade Venzo (Kanban) — Sprint 14.5.
 *
 * Header em stack vertical: nome (line-clamp-2) + valor em gold/tabular-nums
 * abaixo. Empresa em sub-text (line-clamp-1). Badge de estágio movido pro
 * rodapé. Tooltip nativo via `title=` mostra valor completo.
 *
 * border-left muda para danger se follow-up vencido / warning ≤48h.
 */

export interface OpportunityCardData {
  id: string;
  companyName: string;
  /** Título da oportunidade (mostrado em destaque). Cai no companyName se vazio. */
  title?: string | null;
  stage: { label: string; variant: 'default' | 'primary' | 'success' | 'danger' | 'warning' | 'info' };
  valueBrl: number;
  ownerName: string;
  ownerAvatarUrl?: string | null;
  contactName?: string | null;
  nextActivityAt?: Date | null;
  probabilityPct?: number | null;
  daysInStage?: number | null;
  followUpUrgency?: 'ok' | 'soon' | 'overdue';
  aiScorePct?: number | null;
  /**
   * Sprint 15G Fase 4b — nome da unidade primária do owner (equipe/regional
   * onde ele opera). Quando presente, é renderizado como badge subtle no
   * footer pra dar contexto de "de qual equipe essa opp veio". Deixe
   * `undefined` até o backend `opportunities.list` incluir
   * `owner.primaryUnit.name` (débito Sprint 15H).
   */
  ownerUnitName?: string | null;
}

export function OpportunityCard({
  card,
  href,
  className,
}: {
  card: OpportunityCardData;
  href?: string;
  className?: string;
}) {
  const borderClass =
    card.followUpUrgency === 'overdue'
      ? 'border-l-danger'
      : card.followUpUrgency === 'soon'
        ? 'border-l-warning'
        : 'border-l-border';
  const titleText = card.title ?? card.companyName;

  const content = (
    <article
      className={cn(
        'group bg-card border border-border border-l-[3px] rounded-md p-3 transition-all hover:-translate-y-px hover:border-brand-primary hover:shadow-md',
        borderClass,
        className,
      )}
    >
      <header className="space-y-1 mb-2">
        <h3 className="text-[14px] font-semibold text-text-1 leading-[1.3] line-clamp-2">
          {titleText}
        </h3>
        {card.title && (
          <p className="text-caption text-text-2 line-clamp-1">{card.companyName}</p>
        )}
        <div className="flex items-baseline gap-2">
          <span
            title={formatBRL(card.valueBrl)}
            aria-label={formatBRL(card.valueBrl)}
            className="font-mono tabular-nums text-[15px] font-bold text-brand-accent"
          >
            {formatBRLCompact(card.valueBrl)}
          </span>
          {typeof card.probabilityPct === 'number' && (
            <span className="text-caption text-text-3">· {card.probabilityPct}%</span>
          )}
        </div>
      </header>

      {(card.contactName || card.nextActivityAt) && (
        <div className="text-caption text-text-2 mb-2 flex items-center gap-2 min-w-0">
          {card.contactName && <span className="truncate">{card.contactName}</span>}
          {card.contactName && card.nextActivityAt && <span aria-hidden="true">·</span>}
          {card.nextActivityAt && (
            <span className="whitespace-nowrap">{formatRelativeDate(card.nextActivityAt)}</span>
          )}
        </div>
      )}

      <footer className="flex items-center justify-between gap-2 mt-2 pt-2 border-t border-border">
        <div className="flex items-center gap-1.5 min-w-0">
          <Avatar name={card.ownerName} src={card.ownerAvatarUrl} size="xs" />
          <span className="text-caption text-text-2 truncate">{card.ownerName}</span>
          {card.ownerUnitName && (
            <Badge
              variant="default"
              title={`Unidade: ${card.ownerUnitName}`}
              aria-label={`Unidade: ${card.ownerUnitName}`}
              className="max-w-[120px] truncate"
              data-testid="opp-card-owner-unit"
            >
              {card.ownerUnitName}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {typeof card.aiScorePct === 'number' && (
            <Badge variant="primary" dot title="Score IA">
              {card.aiScorePct}%
            </Badge>
          )}
          <Badge variant={card.stage.variant}>{card.stage.label}</Badge>
          {typeof card.daysInStage === 'number' && (
            <span className="text-caption text-text-3 whitespace-nowrap">{card.daysInStage}d</span>
          )}
        </div>
      </footer>
    </article>
  );
  return href ? (
    <Link
      href={href}
      className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary rounded-md"
    >
      {content}
    </Link>
  ) : (
    content
  );
}
