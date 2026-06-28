import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { env } from '@/lib/env';

/**
 * Encriptação de campos sensíveis no nível da aplicação (AES-256-GCM).
 *
 * Usado para `tenant.ai_api_key_encrypted` no Sprint 4. Substitui a chave
 * crua armazenada em ai_api_key (que NÃO é usada).
 *
 * Formato do ciphertext em base64: [iv(12) || tag(16) || ciphertext]
 *
 * A chave mestre vem de TENANT_FIELD_ENCRYPTION_KEY (>=32 chars).
 * Rotação de chave: Sprint 11 implementa rotation com chave antiga como
 * fallback. Por enquanto rotação manual = re-encriptar tudo de uma vez.
 */

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

function deriveKey(): Buffer {
  if (!env.TENANT_FIELD_ENCRYPTION_KEY) {
    throw new Error('TENANT_FIELD_ENCRYPTION_KEY não configurada');
  }
  // scryptSync deriva 32 bytes a partir da master key com salt fixo.
  // Salt fixo é OK aqui porque a chave master já tem 32+ chars de entropia
  // e queremos determinismo (mesma master → mesma key).
  return scryptSync(env.TENANT_FIELD_ENCRYPTION_KEY, 'crm-field-encryption-v1', 32);
}

export function encryptField(plaintext: string): string {
  const key = deriveKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

export function decryptField(payload: string): string {
  const key = deriveKey();
  const buf = Buffer.from(payload, 'base64');
  if (buf.length < IV_LEN + TAG_LEN + 1) {
    throw new Error('payload encriptado inválido');
  }
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(ct), decipher.final()]);
  return dec.toString('utf8');
}

/** Mascarado para mostrar no UI: "sk-ant-...xxxx" */
export function maskApiKey(plaintext: string): string {
  if (plaintext.length <= 12) return '****';
  return `${plaintext.slice(0, 7)}…${plaintext.slice(-4)}`;
}
