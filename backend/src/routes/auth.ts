import { Router } from "express";
import axios from "axios";
import { env } from "../config/env";
import { queryOne, query } from "../db/client";
import { User, Sender } from "../types";
import { signSessionToken, requireAuth, AuthedRequest } from "../middleware/auth";
import { getOrCreateDefaultEtherealCredentials } from "../services/mailer";

const router = Router();

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";

/** Kick off real Google OAuth. */
router.get("/google", (req, res) => {
  if (!env.google.clientId) {
    return res
      .status(500)
      .send("GOOGLE_CLIENT_ID is not configured on the server. Add it to backend/.env.");
  }
  const params = new URLSearchParams({
    client_id: env.google.clientId,
    redirect_uri: env.google.callbackUrl,
    response_type: "code",
    scope: "openid email profile",
    access_type: "offline",
    prompt: "select_account",
  });
  res.redirect(`${GOOGLE_AUTH_URL}?${params.toString()}`);
});

/** Google redirects here with ?code=... */
router.get("/google/callback", async (req, res) => {
  const code = req.query.code as string | undefined;
  if (!code) return res.redirect(`${env.frontendUrl}/?error=missing_code`);

  try {
    const { data: tokenData } = await axios.post(GOOGLE_TOKEN_URL, {
      code,
      client_id: env.google.clientId,
      client_secret: env.google.clientSecret,
      redirect_uri: env.google.callbackUrl,
      grant_type: "authorization_code",
    });

    const { data: profile } = await axios.get(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    let user = await queryOne<User>(`SELECT * FROM users WHERE google_id = $1`, [profile.sub]);
    if (!user) {
      user = await queryOne<User>(
        `INSERT INTO users (google_id, email, name, avatar_url)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [profile.sub, profile.email, profile.name, profile.picture]
      );

      // Give every new user a working default Ethereal sender so "Compose" works immediately.
      const creds = await getOrCreateDefaultEtherealCredentials();
      await query(
        `INSERT INTO senders (tenant_id, name, from_email, smtp_host, smtp_port, smtp_user, smtp_pass, is_default)
         VALUES ($1, $2, $3, $4, $5, $6, $7, true)`,
        [user!.id, "ReachInbox Demo Sender", creds.user, creds.host, creds.port, creds.user, creds.pass]
      );
    }

    // Hand the session off to the frontend as a URL parameter, rather than
    // an httpOnly cookie — see middleware/auth.ts for why: cross-domain
    // cookies get silently dropped by Chrome's Bounce Tracking Protection
    // on this exact frontend->backend->Google->backend->frontend redirect
    // chain, even with fully correct SameSite=None; Secure attributes.
    const token = signSessionToken(user!.id);
    res.redirect(`${env.frontendUrl}/auth/callback?token=${encodeURIComponent(token)}`);
  } catch (err: any) {
    console.error("[auth] Google OAuth failed:", err.response?.data || err.message);
    res.redirect(`${env.frontendUrl}/?error=oauth_failed`);
  }
});

router.get("/me", requireAuth, async (req: AuthedRequest, res) => {
  const user = await queryOne<User>(`SELECT id, email, name, avatar_url, created_at FROM users WHERE id = $1`, [
    req.userId,
  ]);
  if (!user) return res.status(404).json({ error: "User not found" });

  const senders = await query<Sender>(`SELECT id, name, from_email, is_default FROM senders WHERE tenant_id = $1`, [
    req.userId,
  ]);

  const slack = await queryOne(`SELECT team_name, connected_at FROM slack_integrations WHERE tenant_id = $1`, [
    req.userId,
  ]);

  res.json({ user, senders, slackConnected: !!slack, slack });
});

router.post("/logout", (req, res) => {
  // No server-side session to clear anymore — the frontend simply discards
  // the token from its local storage. This endpoint is kept for API shape
  // consistency / in case a future version adds token revocation.
  res.json({ ok: true });
});

export default router;
