import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseLead, _internal } from '@/server/services/inbound-parser.service';

// Mock dispatchChat pra testar caminho IA sem chamar rede.
vi.mock('@/lib/ai/dispatch', () => ({
  dispatchChat: vi.fn(),
}));

// Mock logAiUsage pra não tentar gravar no DB.
vi.mock('@/server/services/ai-usage.service', () => ({
  logAiUsage: vi.fn().mockResolvedValue(undefined),
}));

import { dispatchChat } from '@/lib/ai/dispatch';

const TENANT_ID = '00000000-0000-4000-8000-000000000001';

describe('inbound-parser — matchers regex', () => {
  beforeEach(() => vi.clearAllMocks());

  it('webhook JSON estruturado tem confidence 0.99', async () => {
    const payload = {
      contact: { name: 'Maria Silva', email: 'maria@empresa.com', phone: '+55 11 9 1234-5678', role: 'Diretora' },
      company: { name: 'Empresa LTDA', cnpj: '12.345.678/0001-99', website: 'https://empresa.com.br', segment: 'Tech' },
      interest: { message: 'Interesse Pro', estimated_value: 12000, expected_close_at: '2026-08-15' },
      tracking: { utm_source: 'google', utm_campaign: 'pro-q1' },
    };
    const lead = await parseLead({ tenantId: TENANT_ID, raw: payload, source: 'webhook_custom' });
    expect(lead).not.toBeNull();
    expect(lead!.confidence).toBeCloseTo(0.99, 2);
    expect(lead!.parsedBy).toBe('regex:webhook-custom-json');
    expect(lead!.contact.email).toBe('maria@empresa.com');
    expect(lead!.company.cnpj).toBe('12345678000199');
    expect(lead!.interest.estimatedValue).toBe(12000);
    expect(lead!.interest.expectedCloseAt).toBeInstanceOf(Date);
    expect(lead!.tracking?.utm_source).toBe('google');
    expect(dispatchChat).not.toHaveBeenCalled();
  });

  it('webhook JSON sem email nem cnpj cai pra fallback com confidence baixa', async () => {
    const payload = { contact: { name: 'Só nome' }, company: { name: 'Só razão' } };
    const lead = await parseLead({ tenantId: TENANT_ID, raw: payload, source: 'webhook_custom' });
    // Não tem email nem CNPJ → nada útil, devolve null (não fica em DB)
    expect(lead).toBeNull();
  });

  it('Typeform email plain-text estruturado bate com confidence 0.95', async () => {
    const raw = `Powered by Typeform

Nome: Maria Silva
Email: maria@empresa.com
Empresa: Empresa LTDA
CNPJ: 12.345.678/0001-99
Cargo: Diretora de Compras
Mensagem: Interesse no plano Pro pra 25 vendedores.

typeform.com`;
    const lead = await parseLead({ tenantId: TENANT_ID, raw, source: 'email' });
    expect(lead).not.toBeNull();
    expect(lead!.confidence).toBeCloseTo(0.95, 2);
    expect(lead!.parsedBy).toBe('regex:typeform-v1');
    expect(lead!.contact.name).toBe('Maria Silva');
    expect(lead!.contact.email).toBe('maria@empresa.com');
    expect(lead!.company.cnpj).toBe('12345678000199');
    expect(lead!.contact.role).toBe('Diretora de Compras');
  });

  it('RD Station form bate com confidence 0.9', async () => {
    const raw = `Nova conversão via RD Station Marketing

Nome: João Costa
Email: joao@acme.com.br
Empresa: Acme Solutions
Segmento: Tecnologia
Mensagem: Preciso de mais informações.

Enviado por RD Station`;
    const lead = await parseLead({ tenantId: TENANT_ID, raw, source: 'email' });
    expect(lead).not.toBeNull();
    expect(lead!.confidence).toBeCloseTo(0.9, 2);
    expect(lead!.parsedBy).toBe('regex:rd-station-v1');
    expect(lead!.contact.email).toBe('joao@acme.com.br');
    expect(lead!.company.segment).toBe('Tecnologia');
  });

  it('HTML table form (Cal.com style) extrai pares de <td>', async () => {
    const raw = `<html><body>
<table>
  <tr><td>Nome</td><td>Ana Ribeiro</td></tr>
  <tr><td>Email</td><td>ana@exemplo.com</td></tr>
  <tr><td>Empresa</td><td>Exemplo SA</td></tr>
  <tr><td>Telefone</td><td>(11) 91234-5678</td></tr>
</table>
</body></html>`;
    const lead = await parseLead({ tenantId: TENANT_ID, raw, source: 'email' });
    expect(lead).not.toBeNull();
    expect(lead!.parsedBy).toBe('regex:html-table-form');
    expect(lead!.contact.email).toBe('ana@exemplo.com');
    expect(lead!.company.name).toBe('Exemplo SA');
    expect(lead!.contact.phone).toBeDefined();
  });

  it('plain Campo:Valor sem provider identificador bate no matcher genérico', async () => {
    const raw = `Nome: Carlos Souza
Email: carlos@teste.com
Empresa: Teste Ltda
Cargo: Analista`;
    const lead = await parseLead({ tenantId: TENANT_ID, raw, source: 'email' });
    expect(lead).not.toBeNull();
    expect(lead!.confidence).toBeCloseTo(0.85, 2);
    expect(lead!.parsedBy).toBe('regex:plain-key-value');
    expect(lead!.contact.email).toBe('carlos@teste.com');
    expect(lead!.company.name).toBe('Teste Ltda');
  });

  it('email totalmente livre (sem estrutura) cai no fallback IA', async () => {
    (dispatchChat as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      text: JSON.stringify({
        contact: { name: 'Fernanda Lima', email: 'fer@bigco.com', phone: null, role: 'CFO' },
        company: { name: 'BigCo', cnpj: null, website: null, segment: null },
        interest: { message: 'Interesse em automatizar comissões', estimated_value: null, expected_close_at: null },
      }),
      inputTokens: 100,
      outputTokens: 50,
      usedProvider: 'ANTHROPIC',
      configuredProvider: 'ANTHROPIC',
      usedFallback: false,
      model: 'claude-haiku-4-5',
    });

    const raw = 'Oi! Sou Fernanda, CFO da BigCo. Meu email é fer@bigco.com. Quero automatizar as comissões.';
    const lead = await parseLead({ tenantId: TENANT_ID, raw, source: 'email' });
    expect(lead).not.toBeNull();
    expect(lead!.confidence).toBeCloseTo(0.65, 2);
    expect(lead!.parsedBy).toMatch(/^ai:/);
    expect(lead!.contact.email).toBe('fer@bigco.com');
    expect(dispatchChat).toHaveBeenCalledOnce();
  });

  it('IA retorna JSON sem email nem cnpj útil → devolve null', async () => {
    (dispatchChat as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      text: JSON.stringify({
        contact: { name: null, email: null, phone: null, role: null },
        company: { name: null, cnpj: null, website: null, segment: null },
        interest: { message: null, estimated_value: null, expected_close_at: null },
      }),
      inputTokens: 50,
      outputTokens: 30,
      usedProvider: 'ANTHROPIC',
      configuredProvider: 'ANTHROPIC',
      usedFallback: false,
      model: 'claude-haiku-4-5',
    });

    const lead = await parseLead({ tenantId: TENANT_ID, raw: 'texto sem informação nenhuma', source: 'email' });
    expect(lead).toBeNull();
  });

  it('DataMaskingService é aplicado antes de mandar pra IA (email raw não vaza)', async () => {
    (dispatchChat as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      text: JSON.stringify({
        contact: { email: '[EMAIL_1]', name: '[PESSOA_1]' },
        company: { name: null }, interest: { message: null },
      }),
      inputTokens: 30, outputTokens: 20,
      usedProvider: 'ANTHROPIC', configuredProvider: 'ANTHROPIC', usedFallback: false,
      model: 'claude-haiku-4-5',
    });

    const raw = 'Oi, sou Maria Silva. Meu email é maria@confidencial.com';
    await parseLead({ tenantId: TENANT_ID, raw, source: 'email' });

    const calls = (dispatchChat as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const call = calls[0]![0];
    const sentText = call.chat.messages[0].content;
    // Email real NÃO deve aparecer no payload que chegou ao provider
    expect(sentText).not.toContain('maria@confidencial.com');
    // Token deve estar presente
    expect(sentText).toMatch(/\[EMAIL_\d+\]/);
  });
});

describe('inbound-parser — utilitários internos', () => {
  it('extractKeyValuePairs separa "Chave: Valor" ignorando linhas curtas', () => {
    const raw = `oi
Nome: Fulano
X
Email: f@x.com
:
Sem chave`;
    const pairs = _internal.extractKeyValuePairs(raw);
    expect(pairs.nome).toBe('Fulano');
    expect(pairs.email).toBe('f@x.com');
    // "oi" e "X" e ":" NÃO viram par
    expect(Object.keys(pairs).length).toBe(2);
  });

  it('parseCurrencyBrl lida com "R$ 12.000", "12000,50", "12000.50"', () => {
    expect(_internal.parseCurrencyBrl('R$ 12.000')).toBe(12000);
    expect(_internal.parseCurrencyBrl('12.000,50')).toBe(12000.5);
    expect(_internal.parseCurrencyBrl('12000.50')).toBe(12000.5);
    expect(_internal.parseCurrencyBrl('não é número')).toBeUndefined();
  });

  it('normalizeCnpj strippa qualquer não-dígito', () => {
    expect(_internal.normalizeCnpj('12.345.678/0001-99')).toBe('12345678000199');
    expect(_internal.normalizeCnpj('12345678000199')).toBe('12345678000199');
    expect(_internal.normalizeCnpj('12 345 678 / 0001-99')).toBe('12345678000199');
  });

  it('buildFromKeyValueDict trata alias "empresa" vs "nome" separadamente', () => {
    const dict = { nome: 'Pessoa', empresa: 'Companhia', email: 'p@x.com' };
    const lead = _internal.buildFromKeyValueDict(dict);
    expect(lead.contact.name).toBe('Pessoa');
    expect(lead.company.name).toBe('Companhia');
    expect(lead.contact.email).toBe('p@x.com');
  });

  it('buildFromKeyValueDict extrai email do corpo quando alias não bate', () => {
    // "resposta" não tem alias, mas contém email no valor
    const dict = { resposta: 'me manda no cliente@empresa.com que respondo' };
    const lead = _internal.buildFromKeyValueDict(dict);
    expect(lead.contact.email).toBe('cliente@empresa.com');
  });
});
