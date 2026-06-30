import Link from 'next/link';

export default function Home() {
  return (
    <main className="mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-3xl flex-col gap-8 px-6 py-12 sm:py-20">
      <header className="space-y-3">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-primary/15 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-brand-primary-light">
          Venzo · CRM B2B
        </span>
        <h1 className="text-display tracking-tight">Feche mais. Vença sempre.</h1>
        <p className="text-body-lg text-text-2 max-w-prose">
          A plataforma para times comerciais B2B que precisam de método e velocidade.
          Pipeline visual, IA para resumir comunicações, alertas inteligentes e relatórios
          que mostram onde focar.
        </p>
      </header>

      <div className="flex flex-wrap gap-3">
        <Link
          href="/sign-in"
          className="inline-flex items-center justify-center h-12 px-5 rounded bg-brand-primary text-white font-semibold hover:bg-brand-primary-mid focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2"
        >
          Entrar
        </Link>
        <Link
          href="/sign-up"
          className="inline-flex items-center justify-center h-12 px-5 rounded border border-brand-primary text-brand-primary-light font-semibold hover:bg-brand-primary/10"
        >
          Criar conta
        </Link>
      </div>

      <section className="rounded-md border border-border bg-card p-5">
        <h2 className="text-h3 mb-3">Para rodar localmente</h2>
        <ol className="list-decimal space-y-1.5 pl-5 text-body text-text-2">
          <li><code className="text-mono text-brand-primary-light">cp .env.example .env.local</code></li>
          <li><code className="text-mono text-brand-primary-light">docker compose up -d postgres redis</code></li>
          <li><code className="text-mono text-brand-primary-light">npx prisma migrate deploy</code></li>
          <li><code className="text-mono text-brand-primary-light">npm run db:seed</code></li>
          <li><code className="text-mono text-brand-primary-light">npm run dev</code></li>
        </ol>
      </section>
    </main>
  );
}
