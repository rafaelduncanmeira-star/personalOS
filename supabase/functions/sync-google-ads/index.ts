// Google Ads API (GAQL via REST searchStream) → hub.ad_spend_daily
import { db, env, fetchJson, round2, withRun, window } from "../_shared/hub.ts";

const version = env("GOOGLE_ADS_API_VERSION", "v18");

async function accessToken() {
  const body = new URLSearchParams({
    client_id: env("GOOGLE_OAUTH_CLIENT_ID"), client_secret: env("GOOGLE_OAUTH_CLIENT_SECRET"),
    refresh_token: env("GOOGLE_ADS_REFRESH_TOKEN"), grant_type: "refresh_token",
  });
  const r = await fetchJson<{ access_token: string }>("https://oauth2.googleapis.com/token", { method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded" } });
  return r.access_token;
}

type Row = { campaign: { id: string; name: string }; segments: { date: string }; metrics: { costMicros: string; impressions: string; clicks: string; conversions: number; conversionsValue: number } };

Deno.serve((req) =>
  withRun("google", req, async () => {
    const { from, to } = window(req, 7);
    const token = await accessToken();
    const { data: accounts } = await db.from("ad_accounts").select("id, external_id, product_id").eq("platform", "google").eq("active", true);
    const { data: rules } = await db.from("campaign_product_rules").select("match_regex, product_id, priority").eq("platform", "google").order("priority");
    let rows = 0;
    for (const acc of accounts ?? []) {
      const customerId = acc.external_id.replace(/-/g, "");
      const query = `SELECT campaign.id, campaign.name, segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value
        FROM campaign WHERE segments.date BETWEEN '${from}' AND '${to}' AND metrics.cost_micros > 0`;
      const headers: Record<string, string> = {
        authorization: `Bearer ${token}`, "developer-token": env("GOOGLE_ADS_DEVELOPER_TOKEN"), "content-type": "application/json",
      };
      const login = Deno.env.get("GOOGLE_ADS_LOGIN_CUSTOMER_ID");
      if (login) headers["login-customer-id"] = login.replace(/-/g, "");
      const chunks = await fetchJson<{ results?: Row[] }[]>(`https://googleads.googleapis.com/${version}/customers/${customerId}/googleAds:searchStream`, { method: "POST", headers, body: JSON.stringify({ query }) });
      for (const c of chunks) for (const r of c.results ?? []) {
        const rule = (rules ?? []).find((x) => new RegExp(x.match_regex, "i").test(r.campaign.name));
        const { error } = await db.from("ad_spend_daily").upsert({
          platform: "google", ad_account_id: acc.id, campaign_external_id: r.campaign.id, campaign_name: r.campaign.name,
          product_id: rule?.product_id ?? acc.product_id, day: r.segments.date,
          spend: round2(Number(r.metrics.costMicros) / 1_000_000), impressions: Number(r.metrics.impressions), clicks: Number(r.metrics.clicks),
          leads: Math.round(Number(r.metrics.conversions ?? 0)), purchases: 0, purchase_value: round2(Number(r.metrics.conversionsValue ?? 0)), raw: r,
        }, { onConflict: "platform,ad_account_id,campaign_external_id,day" });
        if (error) throw error;
        rows++;
      }
    }
    return rows;
  }));
