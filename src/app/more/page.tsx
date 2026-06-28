import Link from 'next/link';

const LINKS = [
  { href: '/companies', label: 'Empresas' },
  { href: '/contacts', label: 'Contatos' },
  { href: '/reports', label: 'Relatórios' },
  { href: '/contracts', label: 'Contratos' },
  { href: '/approvals', label: 'Aprovações' },
  { href: '/imports', label: 'Importação' },
  { href: '/admin/alerts', label: 'Admin · Alertas' },
  { href: '/admin/ai', label: 'Admin · IA' },
  { href: '/admin/conversion-rates', label: 'Admin · Taxas de conversão' },
  { href: '/admin/approval-rules', label: 'Admin · Regras de aprovação' },
  { href: '/admin/contracts', label: 'Admin · Contratos' },
  { href: '/admin/partners', label: 'Admin · Parceiros' },
  { href: '/admin/templates', label: 'Admin · Templates' },
  { href: '/admin/email-inbound', label: 'Admin · E-mail Inbound' },
];

export default function MorePage() {
  return (
    <main className="mx-auto max-w-3xl p-4 md:p-6">
      <h1 className="mb-4 text-2xl font-bold">Mais</h1>
      <ul className="space-y-1">
        {LINKS.map((l) => (
          <li key={l.href}>
            <Link
              href={l.href}
              className="block rounded-lg border border-neutral-200 bg-white p-3 text-sm hover:bg-neutral-50"
            >
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
