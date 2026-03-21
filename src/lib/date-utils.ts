/**
 * Date utilities for period selection and comparison ranges.
 * All dates are computed in America/Los_Angeles timezone.
 */

import { REPORTING_TIMEZONE } from '@/lib/contracts/data-contract';

export type Period = 'today' | 'yesterday' | '3d' | '7d' | '14d' | '30d';

export const PERIOD_OPTIONS: { value: Period; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: '3d', label: '3 Days' },
  { value: '7d', label: '7 Days' },
  { value: '14d', label: '14 Days' },
  { value: '30d', label: '30 Days' },
];

function getTodayLA(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: REPORTING_TIMEZONE });
}

function subtractDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
}

export interface DateRange {
  from: string; // YYYY-MM-DD
  to: string;   // YYYY-MM-DD
}

/**
 * Returns { current, comparison } date ranges for a given period.
 * Comparison is the equivalent prior period.
 */
export function getDateRanges(period: Period): { current: DateRange; comparison: DateRange } {
  const today = getTodayLA();
  const yesterday = subtractDays(today, 1);

  switch (period) {
    case 'today': {
      return {
        current: { from: today, to: today },
        comparison: { from: yesterday, to: yesterday },
      };
    }
    case 'yesterday': {
      const dayBefore = subtractDays(yesterday, 1);
      return {
        current: { from: yesterday, to: yesterday },
        comparison: { from: dayBefore, to: dayBefore },
      };
    }
    case '3d': {
      const from = subtractDays(today, 2);
      const compTo = subtractDays(from, 1);
      const compFrom = subtractDays(compTo, 2);
      return {
        current: { from, to: today },
        comparison: { from: compFrom, to: compTo },
      };
    }
    case '7d': {
      const from = subtractDays(today, 6);
      const compTo = subtractDays(from, 1);
      const compFrom = subtractDays(compTo, 6);
      return {
        current: { from, to: today },
        comparison: { from: compFrom, to: compTo },
      };
    }
    case '14d': {
      const from = subtractDays(today, 13);
      const compTo = subtractDays(from, 1);
      const compFrom = subtractDays(compTo, 13);
      return {
        current: { from, to: today },
        comparison: { from: compFrom, to: compTo },
      };
    }
    case '30d': {
      const from = subtractDays(today, 29);
      const compTo = subtractDays(from, 1);
      const compFrom = subtractDays(compTo, 29);
      return {
        current: { from, to: today },
        comparison: { from: compFrom, to: compTo },
      };
    }
    default: {
      // Default to 7d
      const from = subtractDays(today, 6);
      const compTo = subtractDays(from, 1);
      const compFrom = subtractDays(compTo, 6);
      return {
        current: { from, to: today },
        comparison: { from: compFrom, to: compTo },
      };
    }
  }
}

export function isValidPeriod(value: string | null): value is Period {
  return value !== null && ['today', 'yesterday', '3d', '7d', '14d', '30d'].includes(value);
}
