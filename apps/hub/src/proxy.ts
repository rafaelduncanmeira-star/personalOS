import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/supabase-config";

/**
 * Mantém a sessão do Supabase renovada (cookies) e entrega o retorno do magic link
 * em qualquer rota (o Supabase pode redirecionar para a Site URL com ?code=).
 */
export async function proxy(request: NextRequest) {
  const url = request.nextUrl;
  if (url.searchParams.has("code") && url.pathname !== "/auth/callback") {
    const to = url.clone();
    to.pathname = "/auth/callback";
    to.searchParams.set("next", url.pathname);
    return NextResponse.redirect(to);
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    },
  });
  await supabase.auth.getUser(); // renova o token se preciso
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|svg|ico)$).*)"],
};
