import { afterEach } from 'vitest';

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

afterEach(() => {
  // placeholder
});
