'use client';

/**
 * Client component for trends page controls.
 * Metric selector, date range, and comparison period.
 * Navigates via URL params (server component re-renders on change).
 */

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';

interface MetricOption {
  value: string;
  label: string;
}

interface TrendsControlsProps {
  metrics: MetricOption[];
  currentMetric: string;
  dateFrom: string;
  dateTo: string;
  compareFrom: string;
  compareTo: string;
}

export function TrendsControls({
  metrics,
  currentMetric,
  dateFrom,
  dateTo,
  compareFrom,
  compareTo,
}: TrendsControlsProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const updateParam = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      router.push(`/dashboard/trends?${params.toString()}`);
    },
    [router, searchParams],
  );

  return (
    <div className="trends-controls">
      <div className="control-group">
        <label htmlFor="metric-select">Metric</label>
        <select
          id="metric-select"
          value={currentMetric}
          onChange={(e) => updateParam('metric', e.target.value)}
        >
          {metrics.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </div>

      <div className="control-group">
        <label htmlFor="date-from">From</label>
        <input
          id="date-from"
          type="date"
          value={dateFrom}
          onChange={(e) => updateParam('date_from', e.target.value)}
        />
      </div>

      <div className="control-group">
        <label htmlFor="date-to">To</label>
        <input
          id="date-to"
          type="date"
          value={dateTo}
          onChange={(e) => updateParam('date_to', e.target.value)}
        />
      </div>

      <div className="control-group">
        <label htmlFor="compare-from">Compare from</label>
        <input
          id="compare-from"
          type="date"
          value={compareFrom}
          onChange={(e) => updateParam('compare_from', e.target.value)}
        />
      </div>

      <div className="control-group">
        <label htmlFor="compare-to">Compare to</label>
        <input
          id="compare-to"
          type="date"
          value={compareTo}
          onChange={(e) => updateParam('compare_to', e.target.value)}
        />
      </div>
    </div>
  );
}
