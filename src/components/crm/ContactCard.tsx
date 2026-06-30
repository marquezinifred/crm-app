'use client';

import Link from 'next/link';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils/cn';

export interface ContactCardData {
  id: string;
  name: string;
  position?: string | null;
  companyName?: string | null;
  companyHref?: string | null;
  email?: string | null;
  phone?: string | null;
  linkedinUrl?: string | null;
  avatarUrl?: string | null;
  badge?: { label: string; variant: 'primary' | 'success' | 'warning' | 'info' | 'default' };
  nextImportantDate?: { label: string; daysAhead: number } | null;
}

export function ContactCard({ card, className }: { card: ContactCardData; className?: string }) {
  return (
    <article className={cn('bg-card border border-border rounded-md p-4 hover:border-border-strong', className)}>
      <div className="flex items-start gap-3">
        <Avatar name={card.name} src={card.avatarUrl} size="md" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-[15px] font-semibold text-text-1 truncate">{card.name}</h3>
            {card.badge && <Badge variant={card.badge.variant}>{card.badge.label}</Badge>}
          </div>
          {(card.position || card.companyName) && (
            <p className="text-caption text-text-2 mt-0.5 truncate">
              {card.position}
              {card.position && card.companyName && ' · '}
              {card.companyHref ? (
                <Link href={card.companyHref} className="text-brand-primary-light hover:underline">
                  {card.companyName}
                </Link>
              ) : (
                card.companyName
              )}
            </p>
          )}
          {card.nextImportantDate && (
            <p className="text-caption text-warning-text bg-warning-bg/50 rounded px-2 py-1 mt-2 inline-block">
              {card.nextImportantDate.label} em {card.nextImportantDate.daysAhead} dias
            </p>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {card.email && (
          <a
            href={`mailto:${card.email}`}
            className="inline-flex items-center gap-1 h-8 px-2.5 rounded text-caption text-text-2 hover:bg-hover hover:text-text-1"
            aria-label={`Enviar e-mail para ${card.email}`}
          >
            <IconMail /> E-mail
          </a>
        )}
        {card.phone && (
          <a
            href={`tel:${card.phone}`}
            className="inline-flex items-center gap-1 h-8 px-2.5 rounded text-caption text-text-2 hover:bg-hover hover:text-text-1"
            aria-label={`Ligar para ${card.phone}`}
          >
            <IconPhone /> Ligar
          </a>
        )}
        {card.linkedinUrl && (
          <a
            href={card.linkedinUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 h-8 px-2.5 rounded text-caption text-text-2 hover:bg-hover hover:text-text-1"
          >
            <IconLink /> LinkedIn
          </a>
        )}
      </div>
    </article>
  );
}

function IconMail() {
  return <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 7l9 7 9-7"/></svg>;
}
function IconPhone() {
  return <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg>;
}
function IconLink() {
  return <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.72-1.71"/></svg>;
}
