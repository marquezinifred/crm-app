import { POLICY_VERSIONS } from '@/lib/legal/versions';

export const metadata = { title: 'Política de Privacidade' };

export default function PrivacyPage() {
  return (
    <main className="max-w-[720px] mx-auto px-6 py-10 md:py-16 leading-[1.6] text-text-1">
      <header className="mb-8 pb-6 border-b border-border">
        <h1 className="text-h1 text-text-1">Política de Privacidade</h1>
        <p className="text-caption text-text-3 mt-2">
          Versão {POLICY_VERSIONS.PRIVACY_POLICY}
        </p>
      </header>

      <h2 className="text-h2 text-text-1 mt-8 mb-3">1. Quem somos</h2>
      <p className="text-body-lg text-text-2 mb-3">
Operamos um CRM B2B multi-tenant. Cada cliente (tenant) é controlador
        dos dados dos titulares contidos em sua base; nós atuamos como
        operador conforme o art. 5º, VII, da LGPD.
      </p>

      <h2 className="text-h2 text-text-1 mt-8 mb-3">2. Quais dados coletamos</h2>
      <ul className="text-body-lg text-text-2 list-disc pl-6 space-y-1.5 mb-3">
        <li>Dados de cadastro: nome, e-mail corporativo, telefone, cargo.</li>
        <li>Dados profissionais: empresa, segmento, território comercial.</li>
        <li>Dados de uso: páginas visitadas, ações no produto, IP, agente.</li>
        <li>Comunicações: e-mails de prospecção redirecionados ao endpoint inbound.</li>
      </ul>

      <h2 className="text-h2 text-text-1 mt-8 mb-3">3. Finalidades e base legal</h2>
      <p className="text-body-lg text-text-2 mb-3">
Tratamos dados para execução de contrato (art. 7º, V), legítimo interesse
        em prospecção B2B (art. 7º, IX) e cumprimento de obrigação legal
        (Marco Civil Art. 15, retenção de logs de conexão).
      </p>

      <h2 className="text-h2 text-text-1 mt-8 mb-3">4. Compartilhamento</h2>
      <p className="text-body-lg text-text-2 mb-3">
Provedores essenciais: Clerk (autenticação), Resend (e-mail), Anthropic /
        OpenAI (IA com dados mascarados), AWS / Cloudflare (infraestrutura). Não
        vendemos dados pessoais.
      </p>

      <h2 className="text-h2 text-text-1 mt-8 mb-3">5. Seus direitos</h2>
      <p className="text-body-lg text-text-2 mb-3">
Você pode exercer os direitos do art. 18 da LGPD pelo formulário em{' '}
        <a className="text-brand-primary-light underline" href="/privacy-request">/privacy-request</a>. Respondemos em até 15
        dias. Recurso à ANPD: <a className="text-brand-primary-light underline" href="https://www.gov.br/anpd" target="_blank" rel="noopener noreferrer">www.gov.br/anpd</a>.
      </p>

      <h2 className="text-h2 text-text-1 mt-8 mb-3">6. Retenção</h2>
      <p className="text-body-lg text-text-2 mb-3">
Dados de cadastro: enquanto a conta estiver ativa. Logs de conexão: 1 ano
        (Marco Civil). Dados anonimizados: indefinidamente, sem PII.
      </p>

      <h2 className="text-h2 text-text-1 mt-8 mb-3">7. Segurança</h2>
      <p className="text-body-lg text-text-2 mb-3">
TLS 1.2+, criptografia em repouso, RLS PostgreSQL, segregação por tenant,
        WAF Cloudflare, auditoria imutável de acessos.
      </p>

      <h2 className="text-h2 text-text-1 mt-8 mb-3">8. Contato do DPO</h2>
      <p className="text-body-lg text-text-2 mb-3">
Encarregado de Dados: dpo@empresa.com.br.
      </p>
    </main>
  );
}
