'use client';

import { cn } from '@/lib/utils/cn';

export type ActivityKind = 'manual' | 'system' | 'email' | 'meeting' | 'alert' | 'ai_summary';

export interface ActivityItem {
  id: string;
  kind: ActivityKind;
  authorName: string;
  occurredAt: Date;
  title: string;
  body?: string;
}

const KIND_STYLE: Record<ActivityKind, { dot: string; label: string }> = {
  manual: { dot: 'bg-brand-primary', label: 'Nota' },
  system: { dot: 'bg-text-3', label: 'Sistema' },
  email: { dot: 'bg-info', label: 'E-mail' },
  meeting: { dot: 'bg-success', label: 'Reunião' },
  alert: { dot: 'bg-warning', label: 'Alerta' },
  ai_summary: { dot: 'bg-brand-accent', label: 'Resumo IA' },
};

function formatRelative(d: Date): string {
  const diff = Date.now() - d.getTime();
  const m = Math.round(diff / 60_000);
  if (m < 1) return 'agora';
  if (m < 60) return `há ${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `há ${h}h`;
  const days = Math.round(h / 24);
  if (days < 30) return `há ${days}d`;
  return d.toLocaleDateString('pt-BR');
}

function groupByDay(items: ActivityItem[]): Array<{ label: string; items: ActivityItem[] }> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  const groups = new Map<string, ActivityItem[]>();
  for (const it of items) {
    const day = new Date(it.occurredAt);
    day.setHours(0, 0, 0, 0);
    let key: string;
    if (day.getTime() === today.getTime()) key = 'Hoje';
    else if (day.getTime() === yesterday.getTime()) key = 'Ontem';
    else key = day.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
    const arr = groups.get(key) ?? [];
    arr.push(it);
    groups.set(key, arr);
  }
  return Array.from(groups.entries()).map(([label, items]) => ({ label, items }));
}

export function ActivityTimeline({ items, className }: { items: ActivityItem[]; className?: string }) {
  if (items.length === 0) {
    return (
      <p className="text-text-2 text-body py-6">
        Nada por aqui ainda. Adicione a primeira atividade.
      </p>
    );
  }
  const groups = groupByDay(items);
  return (
    <div className={cn('relative', className)}>
      <div aria-hidden="true" className="absolute left-[7px] top-2 bottom-2 w-px bg-border" />
      {groups.map((g) => (
        <section key={g.label} className="mb-5">
          <header className="sticky top-0 z-10 -ml-1 mb-2 inline-flex items-center gap-2 bg-page py-1">
            <span className="text-label text-text-3">{g.label}</span>
          </header>
          <ol className="space-y-3">
            {g.items.map((it) => {
              const style = KIND_STYLE[it.kind];
              return (
                <li key={it.id} className="relative pl-6">
                  <span
                    aria-hidden="true"
                    className={cn('absolute left-0 top-1.5 h-3.5 w-3.5 rounded-full border-2 border-page', style.dot)}
                  />
                  <div className="flex items-baseline gap-2 mb-0.5">
                    <span className="text-caption font-semibold text-text-1">{it.authorName}</span>
                    <span className="text-caption text-text-3">{style.label}</span>
                    <span className="text-caption text-text-3 ml-auto whitespace-nowrap">
                      {formatRelative(it.occurredAt)}
                    </span>
                  </div>
                  <p className="text-[13.5px] text-text-1">{it.title}</p>
                  {it.body && (
                    <p className="text-caption text-text-2 mt-1 leading-relaxed">{it.body}</p>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
