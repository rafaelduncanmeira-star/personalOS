import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getCurrentUser } from "@/lib/auth";
import { integrations, listProducts } from "@/lib/queries";
import { MobileNav, Sidebar } from "@/components/shell";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const [products, sources] = await Promise.all([listProducts(), integrations()]);
  return (
    <>
      <Sidebar user={user} products={products} sources={sources.filter((s) => s.mode !== "manual")} />
      <main className="min-w-0 flex-1 px-4 pb-24 pt-5 md:px-7 md:pb-10">
        <Suspense>{children}</Suspense>
      </main>
      <MobileNav user={user} />
    </>
  );
}
