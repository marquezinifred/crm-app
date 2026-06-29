import { POLICY_VERSIONS } from '@/lib/legal/versions';

export const metadata = { title: 'Política de Privacidade' };

export default function PrivacyPage() {
  return (
    <main className="max-w-3xl mx-auto p-6 md:p-10 prose prose-neutral">
      <header className="not-prose mb-6">
        <h1 className="text-3xl font-semibold">Política de Privacidade</h1>
        <p className="text-sm text-neutral-500">
          Versão {POLICY_VERSIONS.PRIVACY_POLICY}
        </p>
      </header>

      <h2>1. Quem somos</h2>
      <p>
        Operamos um CRM B2B multi-tenant. Cada cliente (tenant) é controlador
        dos dados dos titulares contidos em sua base; nós atuamos como
        operador conforme o art. 5º, VII, da LGPD.
      </p>

      <h2>2. Quais dados coletamos</h2>
      <ul>
        <li>Dados de cadastro: nome, e-mail corporativo, telefone, cargo.</li>
        <li>Dados profissionais: empresa, segmento, território comercial.</li>
        <li>Dados de uso: páginas visitadas, ações no produto, IP, agente.</li>
        <li>Comunicações: e-mails de prospecção redirecionados ao endpoint inbound.</li>
      </ul>

      <h2>3. Finalidades e base legal</h2>
      <p>
        Tratamos dados para execução de contrato (art. 7º, V), legítimo interesse
        em prospecção B2B (art. 7º, IX) e cumprimento de obrigação legal
        (Marco Civil Art. 15, retenção de logs de conexão).
      </p>

      <h2>4. Compartilhamento</h2>
      <p>
        Provedores essenciais: Clerk (autenticação), Resend (e-mail), Anthropic /
        OpenAI (IA com dados mascarados), AWS / Cloudflare (infraestrutura). Não
        vendemos dados pessoais.
      </p>

      <h2>5. Seus direitos</h2>
      <p>
        Você pode exercer os direitos do art. 18 da LGPD pelo formulário em{' '}
        <a href="/privacy-request">/privacy-request</a>. Respondemos em até 15
        dias. Recurso à ANPD: <a href="https://www.gov.br/anpd">www.gov.br/anpd</a>.
      </p>

      <h2>6. Retenção</h2>
      <p>
        Dados de cadastro: enquanto a conta estiver ativa. Logs de conexão: 1 ano
        (Marco Civil). Dados anonimizados: indefinidamente, sem PII.
      </p>

      <h2>7. Segurança</h2>
      <p>
        TLS 1.2+, criptografia em repouso, RLS PostgreSQL, segregação por tenant,
        WAF Cloudflare, auditoria imutável de acessos.
      </p>

      <h2>8. Contato do DPO</h2>
      <p>
        Encarregado de Dados: dpo@empresa.com.br.
      </p>
    </main>
  );
}
