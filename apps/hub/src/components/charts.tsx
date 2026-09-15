"use client";

import { useId, useState } from "react";
import { fmtBRL, fmtBRLCompact, fmtInt, fmtPct } from "@/lib/format";

/* Formatação por chave (funções não atravessam a fronteira server → client) */
export type Fmt = "brl" | "brlc" | "int" | "x" | "pct";
const formatters: Record<Fmt, (v: number) => string> = {
  brl: fmtBRL, brlc: fmtBRLCompact, int: fmtInt, x: (v) => `${v.toFixed(1)}×`, pct: (v) => fmtPct(v, 1),
};

/* Gráficos SVG leves, sem dependência externa.
   Regras: uma escala por gráfico, marcas finas, rótulos diretos seletivos,
   tooltip no hover, cor de série vem dos tokens --series-N. */

type BarDatum = { label: string; value: number; highlight?: boolean; note?: string };

export function BarChart({ data, format, height = 160, projectedLast = false }: {
  data: BarDatum[]; format: Fmt; height?: number; projectedLast?: boolean;
}) {
  const fmt = formatters[format];
  const [hover, setHover] = useState<number | null>(null);
  const id = useId();
  const w = 640; // viewBox fixo; o SVG escala mantendo proporção (texto não distorce)
  const padTop = 22, padBottom = 20;
  const max = Math.max(1, ...data.map((d) => d.value));
  const n = data.length;
  const gap = 10;
  const bw = (w - gap * (n - 1)) / n;
  const plotH = height - padTop - padBottom;
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="xMidYMid meet" className="h-auto w-full" role="img" aria-labelledby={id}>
        <title id={id}>Gráfico de barras</title>
        <line x1={0} x2={w} y1={height - padBottom} y2={height - padBottom} stroke="var(--axis)" strokeWidth={1} />
        {data.map((d, i) => {
          const h = (d.value / max) * plotH;
          const x = i * (bw + gap);
          const y = height - padBottom - h;
          const isProj = projectedLast && i === n - 1;
          const fill = d.highlight ? "var(--brand)" : isProj ? "var(--series-muted)" : "var(--series-2)";
          return (
            <g key={d.label} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={x} y={padTop} width={bw} height={plotH} fill="transparent" />
              <rect x={x} y={y} width={bw} height={Math.max(h, 2)} fill={fill} rx={4} opacity={hover === null || hover === i ? 1 : 0.55} />
              <text x={x + bw / 2} y={y - 6} textAnchor="middle" fontSize={12} fill={d.highlight ? "var(--brand)" : "var(--ink-2)"} fontWeight={d.highlight ? 700 : 500} style={{ fontVariantNumeric: "tabular-nums" }}>
                {fmt(d.value)}
              </text>
              <text x={x + bw / 2} y={height - 5} textAnchor="middle" fontSize={11} fill={d.highlight ? "var(--brand)" : "var(--ink-3)"} fontWeight={700}>
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>
      {hover !== null && data[hover]?.note && (
        <div className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 rounded-md border border-line-strong bg-surface-2 px-3 py-1.5 text-[12px] text-ink shadow-lg">
          {data[hover].note}
        </div>
      )}
    </div>
  );
}

type Series = { name: string; color: string; values: (number | null)[] };

export function LineChart({ labels, series, format, height = 200, yFrom = 0 }: {
  labels: string[]; series: Series[]; format: Fmt; height?: number; yFrom?: number;
}) {
  const fmt = formatters[format];
  const [hover, setHover] = useState<number | null>(null);
  const id = useId();
  const w = 640;
  const padL = 0, padR = 0, padTop = 14, padBottom = 20;
  const all = series.flatMap((s) => s.values).filter((v): v is number => v != null);
  const max = Math.max(yFrom + 1, ...all);
  const min = Math.min(yFrom, ...all);
  const n = labels.length;
  const x = (i: number) => padL + (n <= 1 ? 0 : (i * (w - padL - padR)) / (n - 1));
  const y = (v: number) => padTop + (1 - (v - min) / (max - min)) * (height - padTop - padBottom);
  const ticks = 3;
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="xMidYMid meet" className="h-auto w-full" role="img" aria-labelledby={id}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const rel = (e.clientX - rect.left) / rect.width;
          setHover(Math.max(0, Math.min(n - 1, Math.round(rel * (n - 1)))));
        }}>
        <title id={id}>Gráfico de linhas</title>
        {Array.from({ length: ticks + 1 }, (_, k) => {
          const v = min + ((max - min) * k) / ticks;
          return <g key={k}>
            <line x1={padL} x2={w - padR} y1={y(v)} y2={y(v)} stroke="var(--grid)" strokeWidth={1} />
            <text x={padL} y={y(v) - 4} fontSize={11} fill="var(--ink-3)">{fmt(v)}</text>
          </g>;
        })}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={padTop} y2={height - padBottom} stroke="var(--axis)" strokeWidth={1} strokeDasharray="3 3" />}
        {series.map((s) => {
          const pts = s.values.map((v, i) => (v == null ? null : `${x(i)},${y(v)}`));
          const d = pts.reduce<string>((acc, p, i) => (p == null ? acc : acc + (i === 0 || pts[i - 1] == null ? `M${p}` : `L${p}`)), "");
          return <g key={s.name}>
            <path d={d} fill="none" stroke={s.color} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
            {hover !== null && s.values[hover] != null && (
              <circle cx={x(hover)} cy={y(s.values[hover] as number)} r={5} fill={s.color} stroke="var(--surface)" strokeWidth={2} />
            )}
          </g>;
        })}
        {labels.map((l, i) => (n <= 12 || i % Math.ceil(n / 8) === 0) && (
          <text key={l} x={x(i)} y={height - 5} fontSize={11} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"} fill="var(--ink-3)">{l}</text>
        ))}
      </svg>
      {series.length > 1 && (
        <ul className="mt-2 flex flex-wrap gap-4 text-[12px] text-ink-2">
          {series.map((s) => <li key={s.name} className="flex items-center gap-2"><span className="inline-block h-2 w-3 rounded-sm" style={{ background: s.color }} />{s.name}</li>)}
        </ul>
      )}
      {hover !== null && (
        <div className="pointer-events-none absolute right-0 top-0 rounded-md border border-line-strong bg-surface-2 px-3 py-2 text-[12px] shadow-lg">
          <div className="eyebrow mb-1">{labels[hover]}</div>
          {series.map((s) => <div key={s.name} className="flex items-center gap-2 tnum"><span className="inline-block h-2 w-2 rounded-full" style={{ background: s.color }} />{s.name}: <b>{s.values[hover] == null ? "—" : fmt(s.values[hover] as number)}</b></div>)}
        </div>
      )}
    </div>
  );
}

/** Barras horizontais com rótulo direto (funil, quebra de custos, motivos de perda) */
export function HBars({ data, format, color = "var(--series-1)" }: { data: { label: string; value: number; sub?: string }[]; format: Fmt; color?: string }) {
  const fmt = formatters[format];
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <ul className="space-y-2.5">
      {data.map((d) => (
        <li key={d.label} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 text-[13px]">
          <div>
            <div className="mb-1 flex items-baseline justify-between gap-2"><span className="truncate">{d.label}</span>{d.sub && <span className="text-[11px] text-ink-3">{d.sub}</span>}</div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full" style={{ width: `${(d.value / max) * 100}%`, background: color }} /></div>
          </div>
          <div className="tnum w-20 text-right font-semibold">{fmt(d.value)}</div>
        </li>
      ))}
    </ul>
  );
}
