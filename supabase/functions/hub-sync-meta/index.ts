// Meta Marketing API (Insights por campanha/dia) → hub.ad_spend_daily
import { db, env, fetchJson, productIdFor, round2, withRun, window, secret } from "../_shared/hub.ts";

type Row = { campaign_id: string; campaign_name: string; date_start: string; spend: string; impressions: string; clicks: string; actions?: { action_type: string; value: string }[]; action_values?: { action_type: string; value: string }[] };
const token = (await secret("HUB_META_ACCESS_TOKEN"));
const version = env("META_API_VERSION", "v20.0");
const leadTypes = new Set(["lead", "onsite_conversion.lead_grouped", "offsite_conversion.fb_pixel_lead", "onsite_conversion.messaging_conversation_started_7d"]);
const purchaseTypes = new Set(["purchase", "offsite_conversion.fb_pixel_purchase", "omni_purchase"]);
const sum = (arr: { action_type: string; value: string }[] | undefined, types: Set<string>) => (arr ?? []).filter((a) => types.has(a.action_type)).reduce((s, a) => s + Number(a.value), 0);

async function productForCampaign(accountProduct: string | null, name: string) {
  const { data: rules } = await db.from("campaign_product_rules").select("match_regex, product_id, priority").eq("platform", "meta").order("priority");
  for (const r of rules ?? []) if (new RegExp(r.match_regex, "i").test(name)) return r.product_id;
  return accountProduct;
}

Deno.serve((req) =>
  withRun("meta", req, async () => {
    const { from, to } = window(req, 7);
    const { data: accounts } = await db.from("ad_accounts").select("id, external_id, product_id").eq("platform", "meta").eq("active", true);
    let rows = 0;
    for (const acc of accounts ?? []) {
      const params = new URLSearchParams({
        level: "campaign", time_increment: "1", limit: "500", access_token: token,
        fields: "campaign_id,campaign_name,spend,impressions,clicks,actions,action_values",
        time_range: JSON.stringify({ since: from, until: to }),
      });
      let url: string | null = `https://graph.facebook.com/${version}/${acc.external_id}/insights?${params}`;
      while (url) {
        const page: { data: Row[]; paging?: { next?: string } } = await fetchJson(url);
        for (const r of page.data) {
          const { error } = await db.from("ad_spend_daily").upsert({
            platform: "meta", ad_account_id: acc.id, campaign_external_id: r.campaign_id, campaign_name: r.campaign_name,
            product_id: await productForCampaign(acc.product_id, r.campaign_name) ?? await productIdFor("meta", r.campaign_id),
            day: r.date_start, spend: round2(Number(r.spend)), impressions: Number(r.impressions), clicks: Number(r.clicks),
            leads: Math.round(sum(r.actions, leadTypes)), purchases: Math.round(sum(r.actions, purchaseTypes)),
            purchase_value: round2(sum(r.action_values, purchaseTypes)), raw: r,
          }, { onConflict: "platform,ad_account_id,campaign_external_id,day" });
          if (error) throw error;
          rows++;
        }
        url = page.paging?.next ?? null;
      }
    }
    return rows;
  }));
