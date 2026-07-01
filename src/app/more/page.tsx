import Link from 'next/link';
import { PageHeader } from '@/components/layout/PageHeader';

const LINKS = [
  { href: '/companies', label: 'Empresas' },
  { href: '/contacts', label: 'Contatos' },
  { href: '/reports', label: 'Relatórios' },
  { href: '/contracts', label: 'Contratos' },
  { href: '/approvals', label: 'Aprovações' },
  { href: '/imports', label: 'Importação' },
  { href: '/admin/users', label: 'Admin · Usuários' },
  { href: '/admin/products', label: 'Admin · Produtos' },
  { href: '/admin/billing', label: 'Admin · Plano e cobrança' },
  { href: '/admin/branding', label: 'Admin · Identidade' },
  { href: '/admin/alerts', label: 'Admin · Alertas' },
  { href: '/admin/ai', label: 'Admin · IA' },
  { href: '/admin/conversion-rates', label: 'Admin · Taxas de conversão' },
  { href: '/admin/approval-rules', label: 'Admin · Regras de aprovação' },
  { href: '/admin/contracts', label: 'Admin · Contratos' },
  { href: '/admin/partners', label: 'Admin · Parceiros' },
  { href: '/admin/templates', label: 'Admin · Templates' },
  { href: '/admin/email-inbound', label: 'Admin · E-mail Inbound' },
  { href: '/admin/privacy', label: 'Admin · Solicitações LGPD' },
];

/**
 * /more — usado apenas em mobile (<md). No desktop a Sidebar substitui esta
 * página e o BottomNav que linka pra cá fica oculto via `md:hidden`. Mantemos
 * o conteúdo acessível por URL direta (deep link / e2e) com um aviso visual
 * em viewport grande.
 */
export default function MorePage() {
  return (
    <main className="mx-auto max-w-3xl p-4 md:p-6">
      <PageHeader
        title="Mais"
        description="Configurações e ferramentas adicionais."
      />
      <p className="hidden md:block text-sm text-text-2 mb-4">
        Esta página é otimizada para mobile. No desktop, use o menu lateral à esquerda.
      </p>
      <ul className="space-y-1">
        {LINKS.map((l) => (
          <li key={l.href}>
            <Link
              href={l.href}
              className="block rounded-lg border border-border bg-card p-3 text-sm hover:bg-page focus-visible:ring-2 focus-visible:ring-brand"
            >
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
