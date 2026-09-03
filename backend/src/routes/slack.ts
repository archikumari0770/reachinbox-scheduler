import { Router } from "express";
import axios from "axios";
import { env } from "../config/env";
import { query } from "../db/client";
import { requireAuth, AuthedRequest } from "../middleware/auth";

const router = Router();

const SLACK_AUTHORIZE_URL = "https://slack.com/oauth/v2/authorize";
const SLACK_TOKEN_URL = "https://slack.com/api/oauth.v2.access";

/** "Connect Slack" button hits this. State carries the tenant id through the redirect. */
router.get("/authorize", requireAuth, (req: AuthedRequest, res) => {
  if (!env.slack.clientId) {
    return res.status(500).send("SLACK_CLIENT_ID is not configured on the server. Add it to backend/.env.");
  }
  const params = new URLSearchParams({
    client_id: env.slack.clientId,
    scope: "incoming-webhook,chat:write",
    redirect_uri: env.slack.redirectUri,
    state: req.userId!,
  });
  res.redirect(`${SLACK_AUTHORIZE_URL}?${params.toString()}`);
});

router.get("/callback", async (req, res) => {
  const code = req.query.code as string | undefined;
  const tenantId = req.query.state as string | undefined;
  if (!code || !tenantId) return res.redirect(`${env.frontendUrl}/dashboard?slack=error`);

  try {
    const { data } = await axios.post(
      SLACK_TOKEN_URL,
      new URLSearchParams({
        client_id: env.slack.clientId,
        client_secret: env.slack.clientSecret,
        code,
        redirect_uri: env.slack.redirectUri,
      }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    if (!data.ok) throw new Error(data.error || "slack oauth exchange failed");

    const webhookUrl = data.incoming_webhook?.url;
    const teamName = data.team?.name || "Unknown workspace";
    if (!webhookUrl) throw new Error("no incoming_webhook.url returned — check requested scopes");

    await query(
      `INSERT INTO slack_integrations (tenant_id, team_name, webhook_url, access_token)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (tenant_id) DO UPDATE
       SET team_name = EXCLUDED.team_name, webhook_url = EXCLUDED.webhook_url,
           access_token = EXCLUDED.access_token, connected_at = now()`,
      [tenantId, teamName, webhookUrl, data.access_token]
    );

    res.redirect(`${env.frontendUrl}/dashboard?slack=connected`);
  } catch (err: any) {
    console.error("[slack] OAuth callback failed:", err.response?.data || err.message);
    res.redirect(`${env.frontendUrl}/dashboard?slack=error`);
  }
});

router.post("/disconnect", requireAuth, async (req: AuthedRequest, res) => {
  await query(`DELETE FROM slack_integrations WHERE tenant_id = $1`, [req.userId]);
  res.json({ ok: true });
});

export default router;
