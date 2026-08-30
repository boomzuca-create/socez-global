import type { ProfitPoint } from "../types";

interface ProfitChartProps {
  points: ProfitPoint[];
}

export function ProfitChart({ points }: ProfitChartProps) {
  const width = 720;
  const height = 240;
  const padding = 24;
  const values = points.map((point) => point.value);
  const min = Math.min(0, ...values);
  const max = Math.max(...values, 1);
  const range = max - min || 1;
  const x = (index: number) =>
    padding + (index / Math.max(points.length - 1, 1)) * (width - padding * 2);
  const y = (value: number) => height - padding - ((value - min) / range) * (height - padding * 2);
  const path = points.map((point, index) => `${index === 0 ? "M" : "L"}${x(index)},${y(point.value)}`).join(" ");
  const area = `${path} L${x(points.length - 1)},${height - padding} L${x(0)},${height - padding} Z`;

  return (
    <div className="chart-wrap" aria-label="Cumulative profit chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img">
        <defs>
          <linearGradient id="profitFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#52e2b0" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#52e2b0" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((ratio) => (
          <line
            key={ratio}
            x1={padding}
            x2={width - padding}
            y1={height * ratio}
            y2={height * ratio}
            stroke="rgba(148, 163, 184, 0.12)"
          />
        ))}
        <path d={area} fill="url(#profitFill)" />
        <path d={path} fill="none" stroke="#52e2b0" strokeWidth="3" strokeLinecap="round" />
        {points.map((point, index) => (
          <circle key={point.label} cx={x(index)} cy={y(point.value)} r="4" fill="#07111f" stroke="#52e2b0" strokeWidth="2" />
        ))}
      </svg>
      <div className="chart-labels">
        {points.map((point) => (
          <span key={point.label}>{point.label.replace(" Aug", "")}</span>
        ))}
      </div>
    </div>
  );
}
