import { Suspense, type ReactNode } from "react";
import { MonthNav } from "./shell";

export function PageHeader({ title, subtitle, month, extra }: { title: ReactNode; subtitle?: ReactNode; month?: string; extra?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-[26px] font-bold tracking-tight">{title}</h1>
        {subtitle && <div className="eyebrow mt-1">{subtitle}</div>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {extra}
        {month && <Suspense><MonthNav month={month} /></Suspense>}
      </div>
    </header>
  );
}
