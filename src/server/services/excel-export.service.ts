import ExcelJS from 'exceljs';
import type {
  FunnelStage,
  OwnerPerformance,
  RevenueProjection,
} from './analytics.service';

export interface ExcelReportInput {
  tenantName: string;
  generatedAt: Date;
  funnel: FunnelStage[];
  performance: { rows: OwnerPerformance[]; teamAverage: { active: number; won: number; winRatePct: number; wonValue: number } };
  projection: RevenueProjection;
}

const HEADER_FILL = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FF111827' } };
const HEADER_FONT = { color: { argb: 'FFFFFFFF' }, bold: true };

export async function buildExcelReport(input: ExcelReportInput): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'CRM B2B';
  wb.created = input.generatedAt;

  // Capa
  const cover = wb.addWorksheet('Resumo');
  cover.columns = [
    { header: 'Campo', key: 'k', width: 24 },
    { header: 'Valor', key: 'v', width: 50 },
  ];
  cover.getRow(1).fill = HEADER_FILL;
  cover.getRow(1).font = HEADER_FONT;
  cover.addRows([
    { k: 'Tenant', v: input.tenantName },
    { k: 'Gerado em', v: input.generatedAt.toLocaleString('pt-BR') },
    { k: 'Receita projetada (base)', v: `R$ ${input.projection.base.toLocaleString('pt-BR')}` },
    { k: 'Receita projetada (best)', v: `R$ ${input.projection.best.toLocaleString('pt-BR')}` },
    { k: 'Receita projetada (worst)', v: `R$ ${input.projection.worst.toLocaleString('pt-BR')}` },
    { k: 'Win rate da equipe (%)', v: input.performance.teamAverage.winRatePct },
  ]);

  // Funil
  const funnel = wb.addWorksheet('Funil');
  funnel.columns = [
    { header: 'Estágio', key: 'stage', width: 18 },
    { header: 'Oportunidades', key: 'count', width: 16 },
    { header: 'Valor estimado (R$)', key: 'sumValue', width: 22 },
    { header: 'Conversão p/ próximo (%)', key: 'conv', width: 24 },
  ];
  funnel.getRow(1).fill = HEADER_FILL;
  funnel.getRow(1).font = HEADER_FONT;
  funnel.addRows(
    input.funnel.map((f) => ({
      stage: f.stage,
      count: f.count,
      sumValue: f.sumValue,
      conv: f.conversionToNextPct ?? '—',
    })),
  );

  // Performance
  const perf = wb.addWorksheet('Performance');
  perf.columns = [
    { header: 'Responsável', key: 'name', width: 32 },
    { header: 'Em aberto', key: 'active', width: 12 },
    { header: 'Ganhas', key: 'won', width: 10 },
    { header: 'Perdidas', key: 'lost', width: 10 },
    { header: 'Valor ganho (R$)', key: 'wonValue', width: 20 },
    { header: 'Win rate (%)', key: 'winRatePct', width: 14 },
  ];
  perf.getRow(1).fill = HEADER_FILL;
  perf.getRow(1).font = HEADER_FONT;
  perf.addRows(
    input.performance.rows.map((r) => ({
      name: r.ownerName,
      active: r.active,
      won: r.won,
      lost: r.lost,
      wonValue: r.wonValue,
      winRatePct: r.winRatePct,
    })),
  );
  perf.addRow({});
  perf.addRow({
    name: 'MÉDIA DA EQUIPE',
    active: input.performance.teamAverage.active,
    won: input.performance.teamAverage.won,
    lost: '',
    wonValue: input.performance.teamAverage.wonValue,
    winRatePct: input.performance.teamAverage.winRatePct,
  }).font = { bold: true };

  // Projeção
  const proj = wb.addWorksheet('Projeção');
  proj.columns = [
    { header: 'Estágio', key: 'stage', width: 18 },
    { header: 'Valor base (R$)', key: 'base', width: 18 },
    { header: 'Taxa (%)', key: 'rate', width: 12 },
    { header: 'Ponderado (R$)', key: 'weighted', width: 18 },
  ];
  proj.getRow(1).fill = HEADER_FILL;
  proj.getRow(1).font = HEADER_FONT;
  proj.addRows(
    input.projection.byStage.map((s) => ({
      stage: s.stage,
      base: s.base,
      rate: s.rate,
      weighted: s.weightedValue,
    })),
  );

  const arr = await wb.xlsx.writeBuffer();
  return Buffer.from(arr);
}
