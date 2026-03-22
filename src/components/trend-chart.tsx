'use client';

/**
 * Recharts 3.x uses ESM (es6/index.js) with named re-exports, so
 * tree-shaking works correctly with bundlers like Next.js/webpack/turbopack.
 * Named imports (e.g., `import { LineChart } from 'recharts'`) will
 * only include the components actually used.
 *
 * We still wrap in next/dynamic with ssr: false because Recharts relies
 * on browser APIs (SVG measurement, ResizeObserver) that are unavailable
 * during server-side rendering.
 */

import dynamic from 'next/dynamic';

interface TrendDataPoint {
  date: string;
  value: number | null;
}

export interface TrendChartProps {
  primaryData: TrendDataPoint[];
  comparisonData: TrendDataPoint[] | null;
  metric: string;
  metricLabel: string;
}

const TrendChartInner = dynamic(
  () =>
    import('./trend-chart-inner').then((m) => ({
      default: m.TrendChartInner,
    })),
  {
    ssr: false,
    loading: () => (
      <div
        className="skeleton-cell skeleton-chart"
        style={{ width: '100%', height: 360 }}
      />
    ),
  },
);

export function TrendChart(props: TrendChartProps) {
  return <TrendChartInner {...props} />;
}
