import Link from "next/link";
import type { ReactNode } from "react";
import type { Level } from "@/lib/queries";
import { fmtPct } from "@/lib/format";

export function Card({ title, aside, children, className = "", highlight = false }: {
  title?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string; highlight?: boolean;
}) {
  return (
    <section className={`card p-5 md:p-6 ${highlight ? "border-brand/60" : ""} ${className}`}>
      {(title || aside) && (
        <header className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          {title && <h2 className="text-[17px] font-semibold tracking-tight">{title}</h2>}
          {aside && <div className="eyebrow">{aside}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Kpi({ label, value, sub, tone = "neutral" }: {
  label: string; value: string; sub?: ReactNode; tone?: "neutral" | "good" | "bad" | "brand";
}) {
  const toneCls = { neutral: "text-ink", good: "text-accent", bad: "text-bad", brand: "text-brand" }[tone];
  return (
    <div className="card p-5">
      <div className="eyebrow">{label}</div>
      <div className={`mt-2 text-[26px] font-semibold leading-none tracking-tight md:text-[34px] ${toneCls}`}>{value}</div>
      {sub && <div className="mt-3 text-[12.5px] text-ink-3">{sub}</div>}
    </div>
  );
}

/** Variação percentual com seta; sempre traz o número, nunca só a cor. */
export function Delta({ value, suffix = "", invert = false, digits = 0 }: { value: number | null; suffix?: string; invert?: boolean; digits?: number }) {
  if (value == null || Number.isNaN(value)) return <span className="text-ink-3">sem base</span>;
  const up = value >= 0;
  const good = invert ? !up : up;
  return (
    <span className={good ? "text-accent" : "text-bad"}>
      <span aria-hidden>{up ? "▲" : "▼"}</span> {fmtPct(Math.abs(value), digits)}{suffix}
    </span>
  );
}

const levelMeta: Record<Level, { label: string; cls: string; icon: string }> = {
  critico: { label: "Crítico", cls: "pill-bad", icon: "●" },
  atencao: { label: "Atenção", cls: "pill-warn", icon: "●" },
  saudavel: { label: "Saudável", cls: "pill-good", icon: "●" },
};

export function StatusPill({ level }: { level: Level }) {
  const m = levelMeta[level];
  return (
    <span className={`pill ${m.cls}`}>
      <span aria-hidden className="text-[8px]">{m.icon}</span>
      {m.label}
    </span>
  );
}

export function Tag({ children }: { children: ReactNode }) {
  return <span className="inline-block rounded-md border border-line-strong px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-ink-2">{children}</span>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-line-strong p-6 text-center text-[13px] text-ink-3">{children}</div>;
}

export function ProductLink({ slug, children }: { slug: string; children: ReactNode }) {
  return <Link href={`/produtos/${slug}`} className="font-semibold hover:text-brand">{children}</Link>;
}
