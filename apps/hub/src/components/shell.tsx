"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { HubUser } from "@/lib/auth";
import { monthLabel } from "@/lib/format";
import { shiftMonth } from "@/lib/period";

const nav = [
  { href: "/", label: "Home", icon: "▣", roles: ["*"] },
  { href: "/vendas", label: "Vendas", icon: "↗", roles: ["admin", "gestor", "financeiro", "comercial", "trafego"] },
  { href: "/trafego", label: "Tráfego & ROAS", icon: "◈", roles: ["admin", "gestor", "financeiro", "trafego"] },
  { href: "/comercial", label: "Comercial", icon: "☎", roles: ["admin", "gestor", "financeiro", "comercial"] },
  { href: "/financeiro", label: "Financeiro", icon: "≡", roles: ["admin", "gestor", "financeiro"] },
];
const system = [
  { href: "/integracoes", label: "Integrações", icon: "○" },
];

export function Sidebar({ user, products, sources }: {
  user: HubUser; products: { slug: string; name: string }[]; sources: { display_name: string; enabled: boolean }[];
}) {
  const path = usePathname();
  const isCurrent = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  return (
    <aside className="sticky top-0 hidden h-screen w-[210px] shrink-0 flex-col overflow-y-auto bg-sidebar p-5 md:flex">
      <div className="mb-8 flex items-center gap-2">
        <span className="grid h-9 w-9 place-items-center rounded-full bg-brand text-brand-ink text-lg font-black">G</span>
        <div><div className="text-xl font-black leading-none tracking-tight">Geri</div><div className="eyebrow">Geri Hub</div></div>
      </div>
      <nav className="space-y-1">
        {nav.filter((n) => n.roles.includes("*") || n.roles.includes(user.role)).map((n) => (
          <Link key={n.href} href={n.href} className="nav-link" aria-current={isCurrent(n.href) ? "page" : undefined}>
            <span aria-hidden className="w-4 text-center text-[11px]">{n.icon}</span>{n.label}
          </Link>
        ))}
      </nav>
      <div className="eyebrow mt-7 mb-2">Produtos</div>
      <nav className="space-y-0.5">
        {products.map((p) => (
          <Link key={p.slug} href={`/produtos/${p.slug}`} className="nav-link py-1.5 text-[13px]" aria-current={path === `/produtos/${p.slug}` ? "page" : undefined}>
            <span aria-hidden className="w-4 text-center text-[8px]">·</span>{p.name}
          </Link>
        ))}
      </nav>
      <div className="eyebrow mt-7 mb-2">Sistema</div>
      <nav className="space-y-1">
        {system.map((n) => (
          <Link key={n.href} href={n.href} className="nav-link" aria-current={isCurrent(n.href) ? "page" : undefined}>
            <span aria-hidden className="w-4 text-center text-[11px]">{n.icon}</span>{n.label}
          </Link>
        ))}
      </nav>
      <div className="mt-auto border-t border-line pt-4">
        <div className="eyebrow mb-2">Fontes conectadas</div>
        <ul className="space-y-1 text-[11.5px] text-ink-2">
          {sources.map((s) => (
            <li key={s.display_name} className="flex items-center gap-2">
              <span aria-hidden className={`inline-block h-1.5 w-1.5 rounded-full ${s.enabled ? "bg-accent" : "bg-ink-3"}`} />
              <span className="truncate">{s.display_name.split(" (")[0]}</span>
            </li>
          ))}
        </ul>
        <div className="mt-4 text-[11.5px] text-ink-3">{user.name} · {user.role}</div>
      </div>
    </aside>
  );
}

export function MonthNav({ month }: { month: string }) {
  const sp = useSearchParams();
  const build = (m: string) => {
    const q = new URLSearchParams(sp.toString());
    q.set("mes", m);
    return `?${q.toString()}`;
  };
  return (
    <div className="flex items-center gap-1">
      <Link href={build(shiftMonth(month, -1))} className="btn btn-ghost px-3" aria-label="Mês anterior">‹</Link>
      <span className="btn border border-brand text-brand">{monthLabel(month)}</span>
      <Link href={build(shiftMonth(month, 1))} className="btn btn-ghost px-3" aria-label="Próximo mês">›</Link>
    </div>
  );
}

export function MobileNav({ user }: { user: HubUser }) {
  const path = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 flex justify-around border-t border-line bg-sidebar/95 px-2 py-2 backdrop-blur md:hidden" style={{ paddingBottom: "calc(8px + env(safe-area-inset-bottom, 0px))" }}>
      {nav.filter((n) => n.roles.includes("*") || n.roles.includes(user.role)).map((n) => (
        <Link key={n.href} href={n.href} className={`flex flex-col items-center gap-0.5 text-[10.5px] ${(n.href === "/" ? path === "/" : path.startsWith(n.href)) ? "text-brand" : "text-ink-2"}`}>
          <span aria-hidden>{n.icon}</span>{n.label.split(" ")[0]}
        </Link>
      ))}
    </nav>
  );
}
