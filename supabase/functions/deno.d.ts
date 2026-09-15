// Shim mínimo para checar tipos das funções fora do Deno (npx tsc -p supabase/functions). Não é usado em produção.
declare namespace Deno {
  const env: { get(key: string): string | undefined };
  function serve(handler: (req: Request) => Response | Promise<Response>): void;
}
