'use client';

import * as React from 'react';
import { cn } from '@/lib/utils/cn';

/**
 * FileDropzone — P-19.
 *
 * Componente reusável de upload de arquivo com:
 *  - Click OU drag-and-drop
 *  - Cálculo de SHA-256 via Web Crypto API (crypto.subtle.digest)
 *  - Validação de mime type (via `accept`) e tamanho
 *  - A11y: role=button, tabIndex=0, Enter/Space disparam o picker,
 *    mensagens de erro inline (não usa alert)
 *  - Estados visuais: idle, dragover, calculating, error
 *
 * Consumidores devolvem os bytes ao servidor (via tRPC uploadProxy)
 * e persistem metadata (filename, mimeType, sizeBytes, sha256).
 */

export interface FileMetadata {
  file: File;
  filename: string;
  sizeBytes: number;
  mimeType: string;
  sha256: string;
}

interface FileDropzoneProps {
  accept?: string;
  maxSizeBytes?: number;
  onFileSelected: (metadata: FileMetadata) => void | Promise<void>;
  disabled?: boolean;
  hint?: string;
  className?: string;
}

const DEFAULT_MAX = 20 * 1024 * 1024;

export function computeSha256Hex(buffer: ArrayBuffer): Promise<string> {
  return crypto.subtle.digest('SHA-256', buffer).then((hashBuffer) => {
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  });
}

export function mimeMatchesAccept(file: File, accept: string | undefined): boolean {
  if (!accept) return true;
  const tokens = accept
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  if (tokens.length === 0) return true;

  const name = file.name.toLowerCase();
  const type = (file.type || '').toLowerCase();

  return tokens.some((tok) => {
    if (tok.startsWith('.')) return name.endsWith(tok);
    if (tok.endsWith('/*')) {
      const prefix = tok.slice(0, -1);
      return type.startsWith(prefix);
    }
    return type === tok;
  });
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

export function FileDropzone({
  accept,
  maxSizeBytes = DEFAULT_MAX,
  onFileSelected,
  disabled = false,
  hint,
  className,
}: FileDropzoneProps) {
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const openPicker = React.useCallback(() => {
    if (disabled || busy) return;
    inputRef.current?.click();
  }, [disabled, busy]);

  const handleFile = React.useCallback(
    async (file: File) => {
      setError(null);

      if (!mimeMatchesAccept(file, accept)) {
        setError(
          `Formato não suportado. Aceitos: ${accept ?? 'qualquer'}.`,
        );
        return;
      }
      if (file.size > maxSizeBytes) {
        setError(
          `Arquivo muito grande (${formatBytes(file.size)}). Limite: ${formatBytes(maxSizeBytes)}.`,
        );
        return;
      }

      setBusy(true);
      try {
        const buffer = await file.arrayBuffer();
        const sha256 = await computeSha256Hex(buffer);
        await onFileSelected({
          file,
          filename: file.name,
          sizeBytes: file.size,
          mimeType: file.type || 'application/octet-stream',
          sha256,
        });
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Falha ao processar arquivo.',
        );
      } finally {
        setBusy(false);
        if (inputRef.current) inputRef.current.value = '';
      }
    },
    [accept, maxSizeBytes, onFileSelected],
  );

  return (
    <div className={className}>
      <div
        role="button"
        tabIndex={disabled || busy ? -1 : 0}
        aria-disabled={disabled || busy}
        aria-label="Selecionar arquivo"
        onClick={openPicker}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openPicker();
          }
        }}
        onDragOver={(e) => {
          if (disabled || busy) return;
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          if (disabled || busy) return;
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files[0];
          if (f) void handleFile(f);
        }}
        className={cn(
          'flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 text-center text-sm transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2',
          dragOver
            ? 'border-brand-primary bg-brand-primary/5'
            : 'border-border-strong hover:border-brand-primary hover:bg-page',
          (disabled || busy) && 'cursor-not-allowed opacity-60 hover:border-border-strong',
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          disabled={disabled || busy}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
          }}
          className="hidden"
          data-testid="file-dropzone-input"
        />
        {busy ? (
          <span className="font-medium text-text-1">
            Calculando SHA-256…
          </span>
        ) : (
          <>
            <span className="mb-1 font-medium text-text-1">
              Clique ou arraste um arquivo aqui
            </span>
            {hint && <span className="text-xs text-text-2">{hint}</span>}
          </>
        )}
      </div>

      {error && (
        <p
          role="alert"
          className="mt-2 rounded bg-danger/10 p-2 text-xs text-danger"
        >
          {error}
        </p>
      )}
    </div>
  );
}
