'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc/client';

/**
 * P-16 — Global Command Palette (⌘K).
 *
 * Overlay standalone (não usa <Modal>) porque a semântica de teclado é
 * distinta: ↑/↓ para mover highlight, Enter para navegar. Modal genérico
 * focaria o botão "Fechar" do header em vez do input, e o Tab-trap
 * conflitaria com a navegação por setas dos resultados.
 *
 * Aceita RBAC gracioso: buckets vazios simplesmente somem. Tenant
 * isolation é enforce'd pelo router (`ctx.tenantId`).
 */

type SearchResults = {
  companies: Array<{
    id: string;
    name: string;
    cnpj: string | null;
    city: string | null;
  }>;
  contacts: Array<{
    id: string;
    fullName: string;
    email: string;
    companyName: string | null;
  }>;
  opportunities: Array<{
    id: string;
    title: string;
    stage: string;
    companyName: string | null;
  }>;
  users: Array<{
    id: string;
    fullName: string;
    email: string;
    role: string;
  }>;
};

type FlatResult = {
  key: string;
  bucket: 'companies' | 'contacts' | 'opportunities' | 'users';
  id: string;
  primary: string;
  secondary: string;
  href: string;
};

const BUCKET_LABELS: Record<FlatResult['bucket'], string> = {
  companies: 'Empresas',
  contacts: 'Contatos',
  opportunities: 'Oportunidades',
  users: 'Pessoas do time',
};

function flatten(results: SearchResults | undefined): FlatResult[] {
  if (!results) return [];
  const out: FlatResult[] = [];
  for (const c of results.companies) {
    out.push({
      key: `companies:${c.id}`,
      bucket: 'companies',
      id: c.id,
      primary: c.name,
      secondary: [c.cnpj, c.city].filter(Boolean).join(' · '),
      href: `/companies/${c.id}`,
    });
  }
  for (const c of results.contacts) {
    out.push({
      key: `contacts:${c.id}`,
      bucket: 'contacts',
      id: c.id,
      primary: c.fullName,
      secondary: [c.email, c.companyName].filter(Boolean).join(' · '),
      href: `/contacts/${c.id}`,
    });
  }
  for (const o of results.opportunities) {
    out.push({
      key: `opportunities:${o.id}`,
      bucket: 'opportunities',
      id: o.id,
      primary: o.title,
      secondary: [o.stage, o.companyName].filter(Boolean).join(' · '),
      href: `/pipeline/${o.id}`,
    });
  }
  for (const u of results.users) {
    out.push({
      key: `users:${u.id}`,
      bucket: 'users',
      id: u.id,
      primary: u.fullName,
      secondary: [u.email, u.role].filter(Boolean).join(' · '),
      href: `/admin/users`,
    });
  }
  return out;
}

function BucketIcon({ bucket }: { bucket: FlatResult['bucket'] }) {
  const paths: Record<FlatResult['bucket'], React.ReactNode> = {
    companies: (
      <>
        <path d="M3 21h18M5 21V7l7-4 7 4v14M9 9h.01M15 9h.01M9 13h.01M15 13h.01M9 17h.01M15 17h.01" strokeLinecap="round" />
      </>
    ),
    contacts: (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21c0-4 4-7 8-7s8 3 8 7" />
      </>
    ),
    opportunities: (
      <>
        <path d="M3 3v18h18" strokeLinecap="round" />
        <path d="M7 15l4-4 3 3 5-7" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ),
    users: (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M3 20c0-3 3-5 6-5s6 2 6 5M17 11a3 3 0 100-6M21 20c0-2-1.5-4-4-5" strokeLinecap="round" />
      </>
    ),
  };
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4 shrink-0 text-text-3"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      {paths[bucket]}
    </svg>
  );
}

export function CommandPalette({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);
  const [query, setQuery] = React.useState('');
  const [debouncedQuery, setDebouncedQuery] = React.useState('');
  const [highlight, setHighlight] = React.useState(0);

  // Debounce 200ms — evita disparar tRPC a cada tecla
  React.useEffect(() => {
    if (query.length < 2) {
      setDebouncedQuery('');
      return;
    }
    const t = setTimeout(() => setDebouncedQuery(query), 200);
    return () => clearTimeout(t);
  }, [query]);

  const searchQuery = trpc.search.global.useQuery(
    { query: debouncedQuery },
    { enabled: debouncedQuery.length >= 2, staleTime: 30_000 },
  );

  const flat = React.useMemo(
    () => flatten(searchQuery.data),
    [searchQuery.data],
  );

  // Reset ao abrir
  React.useEffect(() => {
    if (open) {
      setQuery('');
      setDebouncedQuery('');
      setHighlight(0);
      // Foco imediato no input
      const raf = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(raf);
    }
    return;
  }, [open]);

  // Reset highlight quando resultados mudam
  React.useEffect(() => {
    setHighlight(0);
  }, [flat.length]);

  // Trava scroll do body enquanto aberto
  React.useEffect(() => {
    if (!open) return;
    const prev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    return () => {
      document.documentElement.style.overflow = prev;
    };
  }, [open]);

  // Scroll highlight item into view
  React.useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-index="${highlight}"]`,
    );
    // jsdom / SSR não implementam scrollIntoView — no-op é seguro.
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [highlight, open]);

  const navigate = React.useCallback(
    (href: string) => {
      onClose();
      router.push(href);
    },
    [onClose, router],
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (flat.length === 0) return;
      setHighlight((h) => (h + 1) % flat.length);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (flat.length === 0) return;
      setHighlight((h) => (h - 1 + flat.length) % flat.length);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const item = flat[highlight];
      if (item) navigate(item.href);
      return;
    }
  };

  if (!open) return null;

  const showEmpty =
    debouncedQuery.length >= 2 && !searchQuery.isFetching && flat.length === 0;
  const showLoading = debouncedQuery.length >= 2 && searchQuery.isFetching;
  const showHint = debouncedQuery.length < 2;

  const groups: Array<{ bucket: FlatResult['bucket']; items: FlatResult[] }> = [
    'opportunities',
    'companies',
    'contacts',
    'users',
  ].map((b) => ({
    bucket: b as FlatResult['bucket'],
    items: flat.filter((i) => i.bucket === b),
  }));

  return (
    <div
      role="presentation"
      onClick={onClose}
      className="fixed inset-0 z-[70] bg-black/60 flex items-start justify-center p-4 pt-[10vh] animate-fade-in"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Busca global"
        onClick={(e) => e.stopPropagation()}
        className="bg-card border border-border rounded-lg w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[70vh]"
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <svg
            viewBox="0 0 24 24"
            className="h-5 w-5 text-text-3 shrink-0"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded={flat.length > 0}
            aria-controls="command-palette-results"
            aria-autocomplete="list"
            aria-activedescendant={
              flat[highlight] ? `cmd-item-${flat[highlight].key}` : undefined
            }
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Busque empresas, contatos, oportunidades..."
            className="flex-1 bg-transparent text-text-1 text-[15px] outline-none placeholder:text-text-3"
          />
          <kbd className="text-[10px] px-1.5 py-0.5 rounded bg-hover border border-border font-mono text-text-3">
            ESC
          </kbd>
        </div>

        <div
          ref={listRef}
          id="command-palette-results"
          role="listbox"
          className="flex-1 overflow-y-auto"
        >
          {showHint && (
            <div className="px-4 py-8 text-center text-body text-text-3">
              Digite ao menos 2 caracteres para buscar.
            </div>
          )}

          {showLoading && (
            <div className="p-3 space-y-2" aria-live="polite">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-11 rounded bg-hover animate-pulse"
                  aria-hidden="true"
                />
              ))}
              <span className="sr-only">Buscando...</span>
            </div>
          )}

          {showEmpty && (
            <div className="px-4 py-8 text-center">
              <p className="text-body text-text-2">
                Nenhum resultado para{' '}
                <span className="text-text-1 font-medium">
                  &quot;{debouncedQuery}&quot;
                </span>
                .
              </p>
              <p className="text-caption text-text-3 mt-1">
                Tente outro termo — nome, e-mail ou CNPJ.
              </p>
            </div>
          )}

          {!showLoading &&
            !showEmpty &&
            !showHint &&
            groups
              .filter((g) => g.items.length > 0)
              .map((group) => (
                <div key={group.bucket} className="py-2">
                  <div className="px-4 py-1 text-[11px] uppercase tracking-[0.06em] text-text-3 font-medium">
                    {BUCKET_LABELS[group.bucket]}
                  </div>
                  {group.items.map((item) => {
                    const flatIndex = flat.findIndex((f) => f.key === item.key);
                    const isHighlighted = flatIndex === highlight;
                    return (
                      <button
                        key={item.key}
                        id={`cmd-item-${item.key}`}
                        data-index={flatIndex}
                        role="option"
                        aria-selected={isHighlighted}
                        onMouseEnter={() => setHighlight(flatIndex)}
                        onClick={() => navigate(item.href)}
                        className={`w-full text-left flex items-center gap-3 px-4 py-2.5 ${
                          isHighlighted ? 'bg-hover' : ''
                        }`}
                      >
                        <BucketIcon bucket={item.bucket} />
                        <div className="min-w-0 flex-1">
                          <div className="text-body text-text-1 truncate">
                            {item.primary}
                          </div>
                          {item.secondary && (
                            <div className="text-caption text-text-3 truncate">
                              {item.secondary}
                            </div>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              ))}
        </div>

        <div className="border-t border-border px-4 py-2 text-[11px] text-text-3 flex items-center gap-3">
          <span className="flex items-center gap-1">
            <kbd className="px-1 py-0.5 rounded bg-hover border border-border font-mono">
              ↑
            </kbd>
            <kbd className="px-1 py-0.5 rounded bg-hover border border-border font-mono">
              ↓
            </kbd>
            navegar
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1 py-0.5 rounded bg-hover border border-border font-mono">
              ↵
            </kbd>
            abrir
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1 py-0.5 rounded bg-hover border border-border font-mono">
              ESC
            </kbd>
            fechar
          </span>
        </div>
      </div>
    </div>
  );
}
