// @vitest-environment node

/**
 * P-60 — regression test do parsing literal de flags booleanas.
 *
 * z.coerce.boolean() usa Boolean(value) internamente. Isso silenciosamente
 * LIGAVA flags escritas como `MULTI_AI_ENABLED=false` no .env (Boolean
 * de qualquer string não-vazia é true). Este teste garante que o helper
 * envBoolean() interpreta as strings comuns literalmente e não muda
 * comportamento sem alerta.
 *
 * Regressão histórica: os 6 casos de communication-summary-errors só
 * apareciam quando `.env.local` tinha MULTI_AI_ENABLED=true. Quando o
 * dev escrevia `MULTI_AI_ENABLED=false` esperando desligar, o coerce
 * ligava — bypassava o mock silenciosamente e os testes rodavam contra
 * Prisma real, gerando 6 failings pré-existentes desde Sprint 15F.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';

const envBoolean = (defaultValue = false) =>
  z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v) => {
      if (typeof v === 'boolean') return v;
      if (v === undefined || v === null) return defaultValue;
      const s = v.trim().toLowerCase();
      if (s === '' || s === 'false' || s === '0' || s === 'no' || s === 'off')
        return false;
      if (s === 'true' || s === '1' || s === 'yes' || s === 'on') return true;
      return defaultValue;
    });

describe('envBoolean — parsing literal de flags no .env', () => {
  const parse = (v: unknown) => envBoolean(false).parse(v);

  it('undefined usa default (false)', () => {
    expect(parse(undefined)).toBe(false);
  });

  it('default true é respeitado quando ausente', () => {
    expect(envBoolean(true).parse(undefined)).toBe(true);
  });

  it('"true" vira true', () => {
    expect(parse('true')).toBe(true);
  });

  it('"false" vira false (bug do z.coerce.boolean fica corrigido)', () => {
    expect(parse('false')).toBe(false);
  });

  it('"1" vira true e "0" vira false', () => {
    expect(parse('1')).toBe(true);
    expect(parse('0')).toBe(false);
  });

  it('"yes"/"no" e "on"/"off" também são reconhecidos', () => {
    expect(parse('yes')).toBe(true);
    expect(parse('no')).toBe(false);
    expect(parse('on')).toBe(true);
    expect(parse('off')).toBe(false);
  });

  it('case-insensitive e ignora espaços', () => {
    expect(parse('  TRUE ')).toBe(true);
    expect(parse('False')).toBe(false);
  });

  it('string vazia trata como false (não como truthy)', () => {
    expect(parse('')).toBe(false);
  });

  it('boolean passa direto sem coerção', () => {
    expect(parse(true)).toBe(true);
    expect(parse(false)).toBe(false);
  });

  it('valor desconhecido volta pro default (não silenciosamente true)', () => {
    expect(envBoolean(false).parse('maybe')).toBe(false);
    expect(envBoolean(true).parse('maybe')).toBe(true);
  });
});
