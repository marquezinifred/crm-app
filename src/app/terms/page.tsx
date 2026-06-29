import { POLICY_VERSIONS } from '@/lib/legal/versions';

export const metadata = { title: 'Termos de Uso' };

export default function TermsPage() {
  return (
    <main className="max-w-3xl mx-auto p-6 md:p-10 prose prose-neutral">
      <header className="not-prose mb-6">
        <h1 className="text-3xl font-semibold">Termos de Uso</h1>
        <p className="text-sm text-neutral-500">
          Versão {POLICY_VERSIONS.TERMS_OF_USE}
        </p>
      </header>

      <h2>1. Aceite</h2>
      <p>
        Ao usar a plataforma, você declara que possui poderes para vincular
        sua organização e concorda com estes termos.
      </p>

      <h2>2. Licença de uso</h2>
      <p>
        Concedemos licença não exclusiva, intransferível, revogável, limitada à
        sua organização (tenant) e ao plano contratado.
      </p>

      <h2>3. Obrigações do cliente</h2>
      <ul>
        <li>Não compartilhar credenciais (use convite por e-mail interno).</li>
        <li>Não realizar engenharia reversa nem benchmark público sem autorização.</li>
        <li>Garantir base legal para os dados pessoais inseridos.</li>
      </ul>

      <h2>4. Disponibilidade</h2>
      <p>SLA do plano contratado descrito no contrato comercial.</p>

      <h2>5. Suspensão e rescisão</h2>
      <p>
        Podemos suspender o acesso em caso de inadimplência (após aviso) ou
        violação destes termos. Dados ficam disponíveis para portabilidade por
        30 dias após o encerramento.
      </p>

      <h2>6. Limitação de responsabilidade</h2>
      <p>
        Responsabilidade limitada ao valor das mensalidades dos últimos 12 meses.
      </p>

      <h2>7. Foro</h2>
      <p>Foro da comarca de São Paulo/SP.</p>
    </main>
  );
}
