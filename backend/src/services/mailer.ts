import nodemailer, { Transporter } from "nodemailer";
import { env } from "../config/env";
import { Sender } from "../types";

const transporterCache = new Map<string, Transporter>();

/**
 * Ensures a usable Ethereal test account exists. If ETHEREAL_SMTP_USER/PASS
 * are set in .env, those are used (so the same inbox persists across
 * restarts). Otherwise a fresh disposable Ethereal account is created and
 * logged to the console — handy for a zero-config demo.
 */
export async function getOrCreateDefaultEtherealCredentials(): Promise<{
  user: string;
  pass: string;
  host: string;
  port: number;
}> {
  if (env.ethereal.user && env.ethereal.pass) {
    return { user: env.ethereal.user, pass: env.ethereal.pass, host: "smtp.ethereal.email", port: 587 };
  }
  const account = await nodemailer.createTestAccount();
  console.log("─────────────────────────────────────────────");
  console.log("[ethereal] Created a fresh test SMTP account:");
  console.log(`  user: ${account.user}`);
  console.log(`  pass: ${account.pass}`);
  console.log("  Add these to backend/.env as ETHEREAL_SMTP_USER/PASS to reuse them.");
  console.log("─────────────────────────────────────────────");
  return { user: account.user, pass: account.pass, host: account.smtp.host, port: account.smtp.port };
}

function transporterFor(sender: Sender): Transporter {
  const cacheKey = sender.id;
  const cached = transporterCache.get(cacheKey);
  if (cached) return cached;

  const transporter = nodemailer.createTransport({
    host: sender.smtp_host,
    port: sender.smtp_port,
    secure: false,
    auth: { user: sender.smtp_user, pass: sender.smtp_pass },
  });
  transporterCache.set(cacheKey, transporter);
  return transporter;
}

export interface SendResult {
  messageId: string;
  previewUrl: string | null;
}

export async function sendEmail(
  sender: Sender,
  to: string,
  subject: string,
  body: string
): Promise<SendResult> {
  const transporter = transporterFor(sender);
  const info = await transporter.sendMail({
    from: `"${sender.name}" <${sender.from_email}>`,
    to,
    subject,
    text: body,
    html: `<pre style="font-family: inherit; white-space: pre-wrap;">${escapeHtml(body)}</pre>`,
  });
  const previewUrl = nodemailer.getTestMessageUrl(info) || null;
  return { messageId: info.messageId, previewUrl };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
