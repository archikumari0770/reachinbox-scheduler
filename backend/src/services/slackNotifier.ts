import axios from "axios";
import { queryOne } from "../db/client";
import { SlackIntegration } from "../types";

/**
 * Posts a live message to the tenant's connected Slack webhook the moment a
 * sender's hourly rate limit is hit. If the tenant hasn't connected Slack,
 * this is a silent no-op (no throw) — connecting later "just works" on the
 * very next rate-limit event, no redeploy needed, because we look the
 * integration up fresh from Postgres on every call rather than caching it
 * at boot.
 */
export async function notifyRateLimitHit(params: {
  tenantId: string;
  senderEmail: string;
  limit: number;
  windowCount: number;
  nextWindowStart: Date;
  pushedCount: number;
}) {
  const integration = await queryOne<SlackIntegration>(
    `SELECT * FROM slack_integrations WHERE tenant_id = $1`,
    [params.tenantId]
  );
  if (!integration) return; // not connected — do nothing, no crash

  const text =
    `:rotating_light: *Rate limit hit* for sender \`${params.senderEmail}\`\n` +
    `Hit ${params.windowCount}/${params.limit} emails for this hour window.\n` +
    `${params.pushedCount} email(s) rescheduled to start at ${params.nextWindowStart.toISOString()}.`;

  try {
    await axios.post(integration.webhook_url, { text });
  } catch (err: any) {
    console.error("[slack] failed to deliver rate-limit notification:", err.message);
  }
}
