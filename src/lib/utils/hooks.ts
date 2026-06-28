'use client';

import { useEffect, useState } from 'react';

export function useIsMobile(breakpoint = 768): boolean {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, [breakpoint]);
  return isMobile;
}

const PT_BR_FIRST_LAST = (full: string): string => {
  const parts = full.trim().split(/\s+/);
  if (parts.length === 0) return '?';
  const first = parts[0]!;
  if (parts.length === 1) return first.slice(0, 2).toUpperCase();
  return (first[0]! + parts[parts.length - 1]![0]!).toUpperCase();
};

export function initials(fullName: string | null | undefined): string {
  if (!fullName) return '?';
  return PT_BR_FIRST_LAST(fullName);
}

export function daysSince(date: Date | string): number {
  const d = typeof date === 'string' ? new Date(date) : date;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86_400_000));
}

export type Urgency = 'ok' | 'soon' | 'urgent';

/**
 * Verde >7d até deadline / amarelo 2-7d / vermelho <2d ou vencido (§5.3 spec).
 * Se não houver data prevista, usa dias no estágio atual (>14 = urgente).
 */
export function urgencyFromDate(target: Date | string | null | undefined): Urgency {
  if (!target) return 'ok';
  const d = typeof target === 'string' ? new Date(target) : target;
  const diff = Math.floor((d.getTime() - Date.now()) / 86_400_000);
  if (diff < 2) return 'urgent';
  if (diff <= 7) return 'soon';
  return 'ok';
}

export function urgencyFromStageDays(days: number): Urgency {
  if (days > 14) return 'urgent';
  if (days > 7) return 'soon';
  return 'ok';
}

export function brl(value: number | string | null | undefined): string {
  const n = typeof value === 'string' ? Number(value) : value ?? 0;
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 0,
  }).format(n);
}
