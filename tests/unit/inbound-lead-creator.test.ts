import { describe, it, expect } from 'vitest';
import { _internal } from '@/server/services/inbound-lead-creator.service';

const { isBlacklisted, deriveOpportunityTitle, MIN_CONFIDENCE } = _internal;

describe('inbound-lead-creator — anti-spam blacklist', () => {
  it('domínio exato bate', () => {
    expect(isBlacklisted('spammer@spam.com', ['spam.com'])).toBe(true);
    expect(isBlacklisted('user@empresa.com', ['spam.com'])).toBe(false);
  });

  it('sufixo com @ bate', () => {
    expect(isBlacklisted('lead@evil.example.com', ['@evil.example.com'])).toBe(true);
    expect(isBlacklisted('lead@ok.com', ['@evil.example.com'])).toBe(false);
  });

  it('endereço completo bate', () => {
    expect(isBlacklisted('conhecido@abuse.com', ['conhecido@abuse.com'])).toBe(true);
    expect(isBlacklisted('outro@abuse.com', ['conhecido@abuse.com'])).toBe(false);
  });

  it('email undefined não bate mesmo com blacklist populada', () => {
    expect(isBlacklisted(undefined, ['spam.com', '@evil.com'])).toBe(false);
  });

  it('case-insensitive', () => {
    expect(isBlacklisted('SPAM@EVIL.COM', ['evil.com'])).toBe(true);
    expect(isBlacklisted('spam@evil.com', ['EVIL.COM'])).toBe(true);
  });

  it('entradas vazias na blacklist são ignoradas', () => {
    expect(isBlacklisted('a@b.com', ['', ' ', 'valid.com'])).toBe(false);
  });
});

describe('inbound-lead-creator — deriveOpportunityTitle', () => {
  const baseParsed = {
    contact: { name: undefined },
    company: {},
    interest: {},
    confidence: 0.9,
    parsedBy: 'test',
  };

  it('usa mensagem quando tem, trunca em 60 chars', () => {
    const title = deriveOpportunityTitle(
      { ...baseParsed, interest: { message: 'Interesse muito interessante em plano Pro para 25 vendedores da equipe crescente' } },
      'Empresa LTDA',
    );
    expect(title.startsWith('Empresa LTDA — Interesse muito interessante')).toBe(true);
    expect(title.endsWith('…')).toBe(true);
    // Não trunca sem ellipsis
    expect(title.length).toBeLessThanOrEqual('Empresa LTDA — '.length + 60 + 1);
  });

  it('usa mensagem curta sem ellipsis', () => {
    const title = deriveOpportunityTitle(
      { ...baseParsed, interest: { message: 'Curto' } },
      'Empresa LTDA',
    );
    expect(title).toBe('Empresa LTDA — Curto');
  });

  it('cai para contact.name quando não há mensagem', () => {
    const title = deriveOpportunityTitle(
      { ...baseParsed, contact: { name: 'Maria' } },
      'Empresa LTDA',
    );
    expect(title).toBe('Empresa LTDA — Maria');
  });

  it('placeholder quando não tem nem mensagem nem nome', () => {
    const title = deriveOpportunityTitle(baseParsed, 'Empresa LTDA');
    expect(title).toBe('Empresa LTDA (inbound)');
  });
});

describe('inbound-lead-creator — thresholds', () => {
  it('MIN_CONFIDENCE é 0.4 (conforme spec §5)', () => {
    expect(MIN_CONFIDENCE).toBe(0.4);
  });
});
