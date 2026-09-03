import { Router } from "express";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import { query, queryOne, pool } from "../db/client";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import { EmailJob, Sender, ScheduleEmailRequest } from "../types";
import { enqueueEmailSend } from "../queue/emailQueue";
import { parseRecipients } from "../utils/csvParser";
import { searchEmails } from "../services/elasticsearch";
import { env } from "../config/env";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

/**
 * Schedule a batch of emails.
 * Accepts either a JSON body with `recipients: string[]`, or a multipart
 * request with a `file` field (CSV/text) plus the same other fields.
 */
router.post("/schedule", requireAuth, upload.single("file"), async (req: AuthedRequest, res) => {
  try {
    const body: Partial<ScheduleEmailRequest> = req.body;
    const subject = String(body.subject || "").trim();
    const emailBody = String(body.body || "").trim();
    const startTime = body.startTime ? new Date(body.startTime as any) : new Date();
    const delayMs = Math.max(0, parseInt(String(body.delayMs ?? "0"), 10) || 0);
    const hourlyLimit = body.hourlyLimit ? parseInt(String(body.hourlyLimit), 10) : undefined;

    if (!subject || !emailBody) {
      return res.status(400).json({ error: "subject and body are required" });
    }

    let recipients: string[] = [];
    if (req.file) {
      recipients = parseRecipients(req.file.buffer.toString("utf-8"));
    } else if (Array.isArray((body as any).recipients)) {
      recipients = parseRecipients(((body as any).recipients as string[]).join("\n"));
    } else if (typeof (body as any).recipients === "string") {
      recipients = parseRecipients((body as any).recipients);
    }

    if (recipients.length === 0) {
      return res.status(400).json({ error: "No valid recipient email addresses found" });
    }

    const sender = await queryOne<Sender>(
      `SELECT * FROM senders WHERE tenant_id = $1 AND is_default = true LIMIT 1`,
      [req.userId]
    );
    if (!sender) return res.status(400).json({ error: "No sender configured for this account" });

    const client = await pool.connect();
    let batchId: string;
    try {
      await client.query("BEGIN");
      const batchRes = await client.query(
        `INSERT INTO email_batches (tenant_id, subject, body, recipient_count, start_time, delay_ms, hourly_limit)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [
          req.userId,
          subject,
          emailBody,
          recipients.length,
          startTime.toISOString(),
          delayMs,
          hourlyLimit ?? env.worker.maxEmailsPerHourPerSender,
        ]
      );
      batchId = batchRes.rows[0].id;

      const jobRows: EmailJob[] = [];
      for (let i = 0; i < recipients.length; i++) {
        const scheduledAt = new Date(startTime.getTime() + i * delayMs);
        const id = uuidv4();
        const inserted = await client.query(
          `INSERT INTO email_jobs (id, tenant_id, batch_id, sender_id, recipient_email, subject, body, scheduled_at, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'scheduled') RETURNING *`,
          [id, req.userId, batchId, sender.id, recipients[i], subject, emailBody, scheduledAt.toISOString()]
        );
        jobRows.push(inserted.rows[0]);
      }
      await client.query("COMMIT");

      // Enqueue after commit so we never enqueue a row that failed to persist.
      for (const row of jobRows) {
        await enqueueEmailSend(
          {
            emailJobId: row.id,
            tenantId: req.userId!,
            senderId: sender.id,
            recipientEmail: row.recipient_email,
            subject: row.subject,
            body: row.body,
            hourlyLimit,
          },
          new Date(row.scheduled_at)
        );
      }

      res.json({ batchId, scheduledCount: jobRows.length });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err: any) {
    console.error("[emails] schedule failed:", err.message);
    res.status(500).json({ error: "Failed to schedule emails" });
  }
});

router.get("/scheduled", requireAuth, async (req: AuthedRequest, res) => {
  const rows = await query<EmailJob>(
    `SELECT * FROM email_jobs WHERE tenant_id = $1 AND status IN ('scheduled','processing')
     ORDER BY scheduled_at ASC LIMIT 500`,
    [req.userId]
  );
  res.json({ emails: rows });
});

router.get("/sent", requireAuth, async (req: AuthedRequest, res) => {
  const rows = await query<EmailJob>(
    `SELECT * FROM email_jobs WHERE tenant_id = $1 AND status IN ('sent','failed')
     ORDER BY COALESCE(sent_at, updated_at) DESC LIMIT 500`,
    [req.userId]
  );
  res.json({ emails: rows });
});

router.get("/search", requireAuth, async (req: AuthedRequest, res) => {
  const q = String(req.query.q || "").trim();
  if (!q) return res.json({ emails: [] });
  const results = await searchEmails(req.userId!, q);
  res.json({ emails: results });
});

export default router;
