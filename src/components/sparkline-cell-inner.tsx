'use client';

import { LineChart, Line } from 'recharts';

interface SparklineCellInnerProps {
  data: (number | null)[];
  width?: number;
  height?: number;
}

export function SparklineCellInner({
  data,
  width = 100,
  height = 28,
}: SparklineCellInnerProps) {
  const chartData = data.map((v, i) => ({ i, v }));

  // Determine trend direction for color
  const first = data.find((v) => v !== null);
  const last = [...data].reverse().find((v) => v !== null);
  const trendColor =
    first != null && last != null
      ? last >= first ? 'var(--accent, #1a6b64)' : 'var(--danger, #a1363a)'
      : 'var(--accent, #1a6b64)';

  return (
    <LineChart width={width} height={height} data={chartData}>
      <Line
        type="monotone"
        dataKey="v"
        stroke={trendColor}
        strokeWidth={1.5}
        dot={false}
        isAnimationActive={false}
        connectNulls
      />
    </LineChart>
  );
}
