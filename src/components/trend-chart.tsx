'use client';

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { formatMetricValue } from '@/lib/format-utils';

interface TrendDataPoint {
  date: string;
  value: number | null;
}

interface TrendChartProps {
  primaryData: TrendDataPoint[];
  comparisonData: TrendDataPoint[] | null;
  metric: string;
  metricLabel: string;
}

export function TrendChart({ primaryData, comparisonData, metric, metricLabel }: TrendChartProps) {
  const chartData = primaryData.map((point, i) => ({
    date: point.date,
    primary: point.value,
    comparison: comparisonData?.[i]?.value ?? null,
  }));

  const fmt = (v: number | null) => formatMetricValue(v, metric);

  return (
    <div className="trend-chart-wrapper" style={{ width: '100%', height: 360 }}>
      <ResponsiveContainer>
        <LineChart data={chartData} margin={{ top: 8, right: 24, left: 16, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--panel-border, #333)" />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 12, fill: 'var(--muted, #888)' }}
            tickFormatter={(d: string) => {
              const date = new Date(d + 'T00:00:00');
              return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            }}
          />
          <YAxis
            tick={{ fontSize: 12, fill: 'var(--muted, #888)' }}
            tickFormatter={(v: number) => fmt(v)}
            width={72}
          />
          <Tooltip
            formatter={(value, name) => [
              fmt(typeof value === 'number' ? value : null),
              name === 'primary' ? metricLabel : `${metricLabel} (comparison)`,
            ]}
            labelFormatter={(label) => String(label)}
            contentStyle={{
              background: 'var(--panel, #1a1a2e)',
              border: '1px solid var(--panel-border, #333)',
              borderRadius: 6,
              fontSize: 13,
            }}
          />
          {comparisonData && <Legend />}
          <Line
            type="monotone"
            dataKey="primary"
            name={metricLabel}
            stroke="var(--accent, #1a6b64)"
            strokeWidth={2}
            dot={{ r: 3 }}
            activeDot={{ r: 5 }}
            connectNulls={false}
          />
          {comparisonData && (
            <Line
              type="monotone"
              dataKey="comparison"
              name={`${metricLabel} (comparison)`}
              stroke="var(--danger, #a1363a)"
              strokeWidth={2}
              strokeDasharray="5 5"
              dot={{ r: 3 }}
              activeDot={{ r: 5 }}
              connectNulls={false}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
