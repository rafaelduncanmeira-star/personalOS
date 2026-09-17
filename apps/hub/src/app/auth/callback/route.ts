import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/supabase-config";

/** Troca o código do magic link por uma sessão e grava os cookies. */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/";
  const response = NextResponse.redirect(new URL(next.startsWith("/") ? next : "/", url.origin));
  if (!code) return NextResponse.redirect(new URL("/login?erro=link", url.origin));

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => { for (const { name, value, options } of list) response.cookies.set(name, value, options); },
    },
  });
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(new URL(`/login?erro=${encodeURIComponent(error.message)}`, url.origin));
  return response;
}
