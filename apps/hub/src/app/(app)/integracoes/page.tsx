import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui";
import { integrations } from "@/lib/queries";

const modeLabel: Record<string, string> = { api: "API (sincronização agendada)", webhook: "Webhook (tempo real)", import: "Importação de relatório", manual: "Lançamento manual", none: "Sem integração" };

export default async function Integracoes() {
  const rows = await integrations();
  return (
    <>
      <PageHeader title="Integrações" subtitle="Fontes de dados, última sincronização e erros" />
      <Card>
        <table className="data">
          <thead><tr><th>Fonte</th><th>Modo</th><th>Status</th><th>Última sincronização</th><th className="num">Linhas</th><th>Erro</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.source}>
                <td><b>{r.display_name}</b></td>
                <td className="text-ink-2">{modeLabel[r.mode] ?? r.mode}</td>
                <td>{r.enabled ? <span className="pill pill-good">Conectada</span> : <span className="pill pill-warn">Pendente</span>}</td>
                <td className="tnum text-ink-2">{r.last_success_at ? new Date(r.last_success_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—"}</td>
                <td className="num">{r.last_rows ?? "—"}</td>
                <td className="text-bad">{r.last_error ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <div className="eyebrow mt-4">Credenciais ficam em variáveis de ambiente das funções de sincronização; nunca no banco.</div>
    </>
  );
}
