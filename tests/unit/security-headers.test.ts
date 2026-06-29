import { describe, it, expect } from 'vitest';
import { SECURITY_HEADERS, applySecurityHeaders } from '@/lib/security/headers';

describe('security headers', () => {
  it('inclui CSP, frame-options, content-type, referrer e permissions policy', () => {
    expect(SECURITY_HEADERS['Content-Security-Policy']).toMatch(/default-src 'self'/);
    expect(SECURITY_HEADERS['X-Frame-Options']).toBe('DENY');
    expect(SECURITY_HEADERS['X-Content-Type-Options']).toBe('nosniff');
    expect(SECURITY_HEADERS['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(SECURITY_HEADERS['Permissions-Policy']).toMatch(/camera=\(\)/);
  });

  it('CSP bloqueia frame-ancestors (clickjacking)', () => {
    expect(SECURITY_HEADERS['Content-Security-Policy']).toMatch(/frame-ancestors 'none'/);
  });

  it('CSP bloqueia object-src (Flash/Java/legacy plugins)', () => {
    expect(SECURITY_HEADERS['Content-Security-Policy']).toMatch(/object-src 'none'/);
  });

  it('applySecurityHeaders copia todos para o Headers', () => {
    const h = new Headers();
    applySecurityHeaders(h);
    for (const key of Object.keys(SECURITY_HEADERS)) {
      expect(h.get(key)).toBeTruthy();
    }
  });
});
