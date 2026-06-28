'use client';

import { brl } from '@/lib/utils/hooks';
import { STAGE_LABELS } from '@/components/pipeline/types';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@/server/trpc/routers/_app';

type FunnelData = inferRouterOutputs<AppRouter>['reports']['funnel'];

interface Props {
  data: FunnelData;
}

/**
 * Funil em SVG inline. Largura de cada bloco proporcional ao count
 * relativo ao maior estágio. Sem libs externas.
 */
export function FunnelChart({ data }: Props) {
  const max = Math.max(...data.map((f) => f.count), 1);
  const rowHeight = 38;
  const padding = 8;
  const width = 600;

  return (
    <svg
      viewBox={`0 0 ${width} ${data.length * (rowHeight + padding) + padding}`}
      className="w-full"
      role="img"
      aria-label="Funil de pipeline"
    >
      {data.map((f, i) => {
        const w = (f.count / max) * (width - 240);
        const x = (width - 240 - w) / 2 + 30;
        const y = padding + i * (rowHeight + padding);
        return (
          <g key={f.stage}>
            <rect
              x={x}
              y={y}
              width={Math.max(w, 4)}
              height={rowHeight}
              rx={4}
              fill="#1f2937"
              opacity={1 - i * 0.08}
            />
            <text
              x={x + Math.max(w, 4) / 2}
              y={y + rowHeight / 2 + 4}
              textAnchor="middle"
              fill="#fff"
              fontSize={13}
              fontWeight={500}
            >
              {STAGE_LABELS[f.stage]} · {f.count}
            </text>
            <text x={10} y={y + rowHeight / 2 + 4} fontSize={11} fill="#6b7280">
              {brl(f.sumValue)}
            </text>
            {f.conversionToNextPct != null && (
              <text
                x={width - 10}
                y={y + rowHeight + padding - 2}
                textAnchor="end"
                fontSize={11}
                fill={
                  f.conversionToNextPct >= 50
                    ? '#10b981'
                    : f.conversionToNextPct >= 25
                      ? '#f59e0b'
                      : '#ef4444'
                }
              >
                ↓ {f.conversionToNextPct}%
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
