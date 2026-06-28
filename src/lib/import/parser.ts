import Papa from 'papaparse';
import ExcelJS from 'exceljs';

/**
 * Parser unificado CSV/XLSX. Detecta formato pelo nome do arquivo.
 * Retorna headers + linhas (cada linha = array de strings).
 *
 * Limitações:
 *   - CSV: separador detectado automaticamente (papaparse)
 *   - XLSX: lê apenas a primeira aba
 *   - todas as células viram string (coerção fica para validação Zod no engine)
 */

export interface ParseResult {
  headers: string[];
  rows: string[][];
  totalRows: number;
}

export interface ParseOptions {
  previewOnly?: boolean;
  /** Para preview: quantas linhas (default 10). */
  previewLimit?: number;
}

export async function parseFile(
  fileName: string,
  bytes: Uint8Array,
  opts: ParseOptions = {},
): Promise<ParseResult> {
  const ext = fileName.toLowerCase().split('.').pop();
  if (ext === 'csv' || ext === 'tsv') {
    return parseCsv(bytes, opts);
  }
  if (ext === 'xlsx' || ext === 'xls') {
    return parseXlsx(bytes, opts);
  }
  throw new Error(`Formato não suportado: .${ext} (use .csv ou .xlsx)`);
}

function parseCsv(bytes: Uint8Array, opts: ParseOptions): ParseResult {
  const text = new TextDecoder().decode(bytes);
  const result = Papa.parse<string[]>(text, {
    skipEmptyLines: true,
  });
  if (result.errors.length > 0 && result.data.length === 0) {
    throw new Error(`Falha ao ler CSV: ${result.errors[0]?.message ?? 'erro'}`);
  }
  const all = result.data;
  const headers = (all[0] ?? []).map((h) => String(h).trim());
  const rows = all.slice(1);
  const limit = opts.previewOnly ? (opts.previewLimit ?? 10) : rows.length;
  return {
    headers,
    rows: rows.slice(0, limit).map((r) => r.map((v) => String(v ?? '').trim())),
    totalRows: rows.length,
  };
}

async function parseXlsx(bytes: Uint8Array, opts: ParseOptions): Promise<ParseResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('XLSX sem abas');

  const headers: string[] = [];
  const allRows: string[][] = [];
  let totalRows = 0;
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const values: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      values[colNumber - 1] = cellToString(cell.value);
    });
    if (rowNumber === 1) {
      headers.push(...values.map((v) => v.trim()));
    } else {
      allRows.push(values.map((v) => v.trim()));
      totalRows += 1;
    }
  });

  const limit = opts.previewOnly ? (opts.previewLimit ?? 10) : allRows.length;
  return { headers, rows: allRows.slice(0, limit), totalRows };
}

function cellToString(value: ExcelJS.CellValue): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  // Rich text / formula / hyperlink
  if (typeof value === 'object') {
    if ('text' in value && typeof (value as { text?: unknown }).text === 'string') {
      return (value as { text: string }).text;
    }
    if ('result' in value) return String((value as { result: unknown }).result ?? '');
    if ('richText' in value) {
      return (value as { richText: Array<{ text: string }> }).richText
        .map((r) => r.text)
        .join('');
    }
  }
  return String(value);
}
