/** Mês de referência do painel, no fuso de São Paulo. Formato ISO "YYYY-MM". */
export function todaySP(): Date {
  const s = new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" });
  return new Date(s);
}

export function currentMonth(): string {
  const d = todaySP();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function parseMonth(raw: string | string[] | undefined): string {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v && /^\d{4}-\d{2}$/.test(v) ? v : currentMonth();
}

export function shiftMonth(isoMonth: string, delta: number): string {
  const [y, m] = isoMonth.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export const monthStart = (isoMonth: string) => `${isoMonth}-01`;

/** Dia do mês usado para comparar "mesmo período do mês anterior" */
export function dayCut(isoMonth: string): number {
  const t = todaySP();
  return isoMonth === currentMonth() ? t.getDate() : 31;
}
