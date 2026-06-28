import { describe, it, expect } from 'vitest';
import {
  extractSlugFromAddresses,
  fromPostmark,
  fromResend,
} from '@/server/services/inbound-email.service';
import { extractCodigoFromSubject } from '@/server/services/email-link.service';

describe('extractSlugFromAddresses', () => {
  it('extrai slug do endereço crm-<slug>@inbound.', () => {
    expect(extractSlugFromAddresses(['crm-acme-tech@inbound.crm.local'])).toBe('acme-tech');
    expect(extractSlugFromAddresses(['Some Name <crm-beta@inbound.x>'])).toBe('beta');
  });
  it('retorna null sem match', () => {
    expect(extractSlugFromAddresses(['random@example.com'])).toBeNull();
    expect(extractSlugFromAddresses([])).toBeNull();
  });
  it('é case-insensitive no slug', () => {
    expect(extractSlugFromAddresses(['CRM-MyTenant@inbound.x'])).toBe('mytenant');
  });
});

describe('extractCodigoFromSubject', () => {
  it('extrai #uuid do assunto', () => {
    const id = '7f6e5d4c-3b2a-1098-7654-321012345678';
    expect(extractCodigoFromSubject(`Re: proposta #${id}`)).toBe(id);
  });
  it('ignora # com texto alfanumérico curto', () => {
    expect(extractCodigoFromSubject('Re: hashtag #foo')).toBeNull();
  });
  it('aceita # com 8+ chars hex', () => {
    expect(extractCodigoFromSubject('Re: ticket #abcd1234')).toBe('abcd1234');
  });
  it('retorna null para subject vazio', () => {
    expect(extractCodigoFromSubject(null)).toBeNull();
    expect(extractCodigoFromSubject('')).toBeNull();
  });
});

describe('fromPostmark', () => {
  it('normaliza payload completo', () => {
    const r = fromPostmark({
      FromFull: { Email: 'cliente@x.com' },
      ToFull: [{ Email: 'crm-acme@inbound.x' }],
      CcFull: [{ Email: 'gestor@empresa.com' }],
      Subject: 'Olá',
      TextBody: 'Olá, mundo',
      HtmlBody: '<p>Olá</p>',
      Date: '2026-06-27T10:00:00Z',
    });
    expect(r.from).toBe('cliente@x.com');
    expect(r.to).toEqual(['crm-acme@inbound.x']);
    expect(r.cc).toEqual(['gestor@empresa.com']);
    expect(r.subject).toBe('Olá');
    expect(r.textBody).toBe('Olá, mundo');
  });
});

describe('fromResend', () => {
  it('normaliza payload Resend', () => {
    const r = fromResend({
      from: { email: 'cliente@x.com' },
      to: ['crm-acme@inbound.x'],
      cc: [{ email: 'gestor@empresa.com' }],
      subject: 'Re: deal',
      text: 'OK',
    });
    expect(r.from).toBe('cliente@x.com');
    expect(r.to).toEqual(['crm-acme@inbound.x']);
    expect(r.cc).toEqual(['gestor@empresa.com']);
  });
});
