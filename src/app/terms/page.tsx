import { POLICY_VERSIONS } from '@/lib/legal/versions';

export const metadata = { title: 'Termos de Uso' };

export default function TermsPage() {
  return (
    <main className="max-w-[720px] mx-auto px-6 py-10 md:py-16 leading-[1.6] text-text-1">
      <header className="mb-8 pb-6 border-b border-border">
        <h1 className="text-h1 text-text-1">Termos de Uso</h1>
        <p className="text-caption text-text-3 mt-2">
          Versão {POLICY_VERSIONS.TERMS_OF_USE}
        </p>
      </header>

      <h2 className="text-h2 text-text-1 mt-8 mb-3">1. Aceite</h2>
      <p className="text-body-lg text-text-2 mb-3">
        Ao usar a plataforma, você declara que possui poderes para vincular
        sua organização e concorda com estes termos.
      </p>

      <h2 className="text-h2 text-text-1 mt-8 mb-3">2. Licença de uso</h2>
      <p className="text-body-lg text-text-2 mb-3">
        Concedemos licença não exclusiva, intransferível, revogável, limitada à
        sua organização (tenant) e ao plano contratado.
      </p>

      <h2 className="text-h2 text-text-1 mt-8 mb-3">3. Obrigações do cliente</h2>
      <ul className="text-body-lg text-text-2 list-disc pl-6 space-y-1.5 mb-3">
        <li>Não compartilhar credenciais (use convite por e-mail interno).</li>
        <li>Não realizar engenharia reversa nem benchmark público sem autorização.</li>
        <li>Garantir base legal para os dados pessoais inseridos.</li>
      </ul>

      <h2 className="text-h2 text-text-1 mt-8 mb-3">4. Disponibilidade</h2>
      <p className="text-body-lg text-text-2 mb-3">
        SLA do plano contratado descrito no contrato comercial.
      </p>

      <h2 className="text-h2 text-text-1 mt-8 mb-3">5. Suspensão e rescisão</h2>
      <p className="text-body-lg text-text-2 mb-3">
        Podemos suspender o acesso em caso de inadimplência (após aviso) ou
        violação destes termos. Dados ficam disponíveis para portabilidade por
        30 dias após o encerramento.
      </p>

      <h2 className="text-h2 text-text-1 mt-8 mb-3">6. Limitação de responsabilidade</h2>
      <p className="text-body-lg text-text-2 mb-3">
        Responsabilidade limitada ao valor das mensalidades dos últimos 12 meses.
      </p>

      <h2 className="text-h2 text-text-1 mt-8 mb-3">7. Foro</h2>
      <p className="text-body-lg text-text-2 mb-3">Foro da comarca de São Paulo/SP.</p>
    </main>
  );
}
