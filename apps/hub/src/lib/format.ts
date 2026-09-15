const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const brlCents = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });
const int = new Intl.NumberFormat("pt-BR");

export const fmtBRL = (v: number | null | undefined) => (v == null ? "—" : brl.format(v));
export const fmtBRLCents = (v: number | null | undefined) => (v == null ? "—" : brlCents.format(v));
export const fmtInt = (v: number | null | undefined) => (v == null ? "—" : int.format(v));
export const fmtPct = (v: number | null | undefined, digits = 0) =>
  v == null || Number.isNaN(v) ? "—" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: digits })}%`;
export const fmtX = (v: number | null | undefined) =>
  v == null || Number.isNaN(v) ? "—" : `${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}×`;

/** "R$ 187,4k" para tiles compactos */
export const fmtBRLCompact = (v: number | null | undefined) => {
  if (v == null) return "—";
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `R$ ${(v / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}M`;
  if (abs >= 1_000) return `R$ ${(v / 1_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}k`;
  return brl.format(v);
};

export const monthLabel = (isoMonth: string) => {
  const [y, m] = isoMonth.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
};
export const monthShort = (isoMonth: string) => {
  const [y, m] = isoMonth.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("pt-BR", { month: "short" }).replace(".", "").toUpperCase();
};
export const dateLong = (d: Date) =>
  d.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", timeZone: "America/Sao_Paulo" });
export const timeShort = (d: Date) =>
  d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

export const delta = (cur: number, prev: number) => (prev ? ((cur - prev) / prev) * 100 : null);
