// Meta Marketing API (Insights por campanha/dia) → hub.ad_spend_daily
import { env, fetchJson, productIdFor, round2, secret, sql, upsert, withRun, window } from "../_shared/hub.ts";

type Row = { campaign_id: string; campaign_name: string; date_start: string; spend: string; impressions: string; clicks: string; actions?: { action_type: string; value: string }[]; action_values?: { action_type: string; value: string }[] };
const token = await secret("HUB_META_ACCESS_TOKEN");
const version = env("HUB_META_API_VERSION", "v20.0");
const leadTypes = new Set(["lead", "onsite_conversion.lead_grouped", "offsite_conversion.fb_pixel_lead", "onsite_conversion.messaging_conversation_started_7d"]);
const purchaseTypes = new Set(["purchase", "offsite_conversion.fb_pixel_purchase", "omni_purchase"]);
const sum = (arr: { action_type: string; value: string }[] | undefined, types: Set<string>) => (arr ?? []).filter((a) => types.has(a.action_type)).reduce((s, a) => s + Number(a.value), 0);

Deno.serve((req) =>
  withRun("meta", req, async () => {
    const { from, to } = window(req, 7);
    const accounts = await sql<{ id: string; external_id: string; product_id: string | null }[]>`select id, external_id, product_id from hub.ad_accounts where platform = 'meta' and active`;
    const rules = await sql<{ match_regex: string; product_id: string }[]>`select match_regex, product_id from hub.campaign_product_rules where platform = 'meta' order by priority`;
    let rows = 0;
    for (const acc of accounts) {
      const params = new URLSearchParams({
        level: "campaign", time_increment: "1", limit: "500", access_token: token,
        fields: "campaign_id,campaign_name,spend,impressions,clicks,actions,action_values",
        time_range: JSON.stringify({ since: from, until: to }),
      });
      let url: string | null = `https://graph.facebook.com/${version}/${acc.external_id}/insights?${params}`;
      while (url) {
        const page: { data: Row[]; paging?: { next?: string } } = await fetchJson(url);
        for (const r of page.data) {
          const rule = rules.find((x) => new RegExp(x.match_regex, "i").test(r.campaign_name));
          await upsert("ad_spend_daily", {
            platform: "meta", ad_account_id: acc.id, campaign_external_id: r.campaign_id, campaign_name: r.campaign_name,
            product_id: rule?.product_id ?? acc.product_id ?? (await productIdFor("meta", r.campaign_id)),
            day: r.date_start, spend: round2(Number(r.spend)), impressions: Number(r.impressions), clicks: Number(r.clicks),
            leads: Math.round(sum(r.actions, leadTypes)), purchases: Math.round(sum(r.actions, purchaseTypes)),
            purchase_value: round2(sum(r.action_values, purchaseTypes)), raw: r,
          }, ["platform", "ad_account_id", "campaign_external_id", "day"]);
          rows++;
        }
        url = page.paging?.next ?? null;
      }
    }
    return rows;
  }));
