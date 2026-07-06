import { afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';

// Sprint 0: setup minimalista. Sprint 1+ adiciona:
//   - reset de banco de teste por arquivo
//   - mock do Clerk
//   - mock do Resend
//   - factories de seed (createTenant, createUser, createCompany, etc.)

// P-19 — jsdom não implementa Blob.arrayBuffer(); polyfill via FileReader
// (que jsdom implementa) pra tests envolvendo upload/hash.
if (typeof Blob !== 'undefined' && typeof Blob.prototype.arrayBuffer !== 'function') {
  Blob.prototype.arrayBuffer = function (this: Blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(this);
    });
  };
}

// P-53 — Testing Library cleanup entre testes evita vazamento de DOM
// e handlers de context (ToastProvider, mocks) entre casos.
afterEach(() => {
  cleanup();
});
