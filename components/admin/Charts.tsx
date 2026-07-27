/**
 * Tiny server-rendered SVG charts for the admin dashboard — crisp at any DPI,
 * zero client JS, styled to the site's white/blue system.
 */

export function Sparkline({ points, stroke = "var(--color-blue)", fill }: {
  points: number[]; stroke?: string; fill?: string;
}) {
  const w = 120, h = 36, pad = 2;
  const max = Math.max(1, ...points);
  const step = points.length > 1 ? (w - pad * 2) / (points.length - 1) : 0;
  const xy = points.map((v, i) => [pad + i * step, h - pad - (v / max) * (h - pad * 2)]);
  const line = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${(pad + (points.length - 1) * step).toFixed(1)},${h - pad} L${pad},${h - pad} Z`;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden className="overflow-visible">
      {/* default area = stroke token at 12% (was rgba blue); explicit fill overrides pass through untouched */}
      <path d={area} fill={fill ?? stroke} fillOpacity={fill ? undefined : 0.12} />
      <path d={line} fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {xy.length > 0 && <circle cx={xy[xy.length - 1][0]} cy={xy[xy.length - 1][1]} r="2.6" fill={stroke} />}
    </svg>
  );
}

export function BarChart({ data }: { data: { label: string; value: number }[] }) {
  const w = 560, h = 190, padB = 22, padL = 6;
  const max = Math.max(1, ...data.map((d) => d.value));
  const bw = (w - padL * 2) / data.length;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img" aria-label="Calls per day">
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <line key={f} x1={padL} x2={w - padL} y1={h - padB - f * (h - padB - 12)} y2={h - padB - f * (h - padB - 12)} stroke="var(--color-line)" strokeWidth="1" />
      ))}
      {data.map((d, i) => {
        const bh = (d.value / max) * (h - padB - 12);
        const x = padL + i * bw + bw * 0.2;
        return (
          <g key={d.label}>
            {/* latest bar full blue; earlier bars sky at 55% to keep the lighter #9cc6ee look */}
            <rect x={x} y={h - padB - bh} width={bw * 0.6} height={Math.max(bh, d.value > 0 ? 3 : 0)} rx="3"
              fill={i === data.length - 1 ? "var(--color-blue)" : "var(--color-sky)"}
              fillOpacity={i === data.length - 1 ? undefined : 0.55} />
            {d.value > 0 && (
              <text x={x + bw * 0.3} y={h - padB - bh - 5} textAnchor="middle" fontSize="10" fill="var(--color-muted)">{d.value}</text>
            )}
            {/* muted at 75% approximates the lighter #8aa0b8 axis tint */}
            <text x={x + bw * 0.3} y={h - 7} textAnchor="middle" fontSize="9" fill="var(--color-muted)" fillOpacity={0.75}>{d.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

export function HBar({ value, max, color = "var(--color-blue)" }: { value: number; max: number; color?: string }) {
  const pct = Math.max(4, Math.round((value / Math.max(1, max)) * 100));
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-paper-2">
      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}
