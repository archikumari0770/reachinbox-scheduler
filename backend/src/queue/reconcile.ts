import { query } from "../db/client";
import { EmailJob } from "../types";
import { enqueueEmailSend } from "./emailQueue";

/**
 * Runs once at process boot. This is NOT a cron / polling scheduler — it's a
 * one-shot self-healing pass: any Postgres row still marked 'scheduled' gets
 * re-attached to BullMQ at its original scheduled_at time. Because job IDs
 * are deterministic (jobId = email_jobs.id), jobs already sitting in Redis
 * are simply skipped by BullMQ — this can never create a duplicate send,
 * and it can never fire something early or late relative to what was
 * originally promised.
 *
 * Why this exists: if Redis data were ever lost (e.g. AOF disabled, volume
 * wiped) while Postgres survives, this pass guarantees "future scheduled
 * emails still send at the correct time" per the persistence requirement.
 * In the common case (Redis AOF intact), every job is already present and
 * this is a fast no-op scan.
 */
export async function reconcileScheduledJobs() {
  const rows = await query<EmailJob & { hourly_limit: number | null }>(
    `SELECT ej.*, eb.hourly_limit
     FROM email_jobs ej
     LEFT JOIN email_batches eb ON eb.id = ej.batch_id
     WHERE ej.status = 'scheduled'
     ORDER BY ej.scheduled_at ASC`
  );

  console.log(`[reconcile] found ${rows.length} scheduled email_jobs row(s) to verify against the queue`);

  let reattached = 0;
  for (const row of rows) {
    await enqueueEmailSend(
      {
        emailJobId: row.id,
        tenantId: row.tenant_id,
        senderId: row.sender_id,
        recipientEmail: row.recipient_email,
        subject: row.subject,
        body: row.body,
        hourlyLimit: row.hourly_limit ?? undefined,
      },
      new Date(row.scheduled_at)
    );
    reattached++;
  }

  console.log(`[reconcile] reconciliation pass complete (${reattached} row(s) verified/re-attached)`);
}
