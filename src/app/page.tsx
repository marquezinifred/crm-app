export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 p-8 sm:p-16">
      <header className="space-y-2">
        <span className="inline-block rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-emerald-700">
          Sprint 0 concluído
        </span>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">CRM B2B Multi-tenant</h1>
        <p className="text-sm text-neutral-600">
          Fundação técnica pronta. Próximos passos: configurar Clerk, rodar migrações
          contra o Postgres e seguir para o Sprint 1 (Autenticação e Cadastros Base).
        </p>
      </header>

      <section className="rounded-lg border border-neutral-200 bg-neutral-50 p-4">
        <h2 className="mb-2 font-semibold">Para começar localmente</h2>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-neutral-700">
          <li>
            <code className="rounded bg-white px-1 py-0.5">cp .env.example .env.local</code> e preencha as variáveis
          </li>
          <li>
            <code className="rounded bg-white px-1 py-0.5">docker compose up -d postgres redis</code>
          </li>
          <li>
            <code className="rounded bg-white px-1 py-0.5">npx prisma migrate deploy</code>
          </li>
          <li>
            <code className="rounded bg-white px-1 py-0.5">npm run db:seed</code>
          </li>
          <li>
            <code className="rounded bg-white px-1 py-0.5">npm run dev</code>
          </li>
        </ol>
      </section>

      <section className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
        <Card title="Health check" code="GET /api/v1/health" />
        <Card title="tRPC" code="POST /api/trpc/health" />
        <Card title="Schema Prisma" code="prisma/schema.prisma" />
        <Card title="Especificação" code="docs/CRM_Especificacao_e_Implementacao.docx" />
      </section>
    </main>
  );
}

function Card({ title, code }: { title: string; code: string }) {
  return (
    <div className="rounded-md border border-neutral-200 p-3">
      <p className="text-xs uppercase tracking-wide text-neutral-500">{title}</p>
      <code className="text-sm">{code}</code>
    </div>
  );
}
