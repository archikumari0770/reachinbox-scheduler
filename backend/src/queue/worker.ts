import { Worker, Job, DelayedError } from "bullmq";
import { redisConnection } from "./connection";
import { EMAIL_QUEUE_NAME } from "./emailQueue";
import { env } from "../config/env";
import { queryOne, query } from "../db/client";
import { EmailJob, EmailJobQueueData, Sender } from "../types";
import { sendEmail } from "../services/mailer";
import { tryConsumeRateLimit } from "./rateLimiter";
import { notifyRateLimitHit } from "../services/slackNotifier";
import { indexEmail } from "../services/elasticsearch";

async function handle(job: Job<EmailJobQueueData>, token?: string) {
  const { emailJobId, senderId, recipientEmail, subject, body, tenantId, hourlyLimit } = job.data;

  // --- Idempotency guard -------------------------------------------------
  // Only proceed if the row is still 'scheduled'. This makes it safe even if
  // BullMQ were to ever deliver the same job twice (retries, at-least-once
  // delivery semantics, a crashed worker re-picking up "active" jobs, etc.)
  const claimed = await queryOne<EmailJob>(
    `UPDATE email_jobs SET status = 'processing', updated_at = now()
     WHERE id = $1 AND status = 'scheduled'
     RETURNING *`,
    [emailJobId]
  );
  if (!claimed) {
    console.log(`[worker] job ${emailJobId} already handled elsewhere — skipping (idempotent no-op)`);
    return;
  }

  // --- Hourly rate limit (Redis-atomic, safe across many workers) --------
  const rate = await tryConsumeRateLimit(senderId, hourlyLimit);
  if (!rate.allowed) {
    console.log(
      `[worker] sender ${senderId} over hourly cap (${rate.count}/${rate.limit}) — rescheduling ${emailJobId} to ${rate.nextWindowStart.toISOString()}`
    );

    await query(
      `UPDATE email_jobs SET status = 'scheduled', scheduled_at = $2, updated_at = now() WHERE id = $1`,
      [emailJobId, rate.nextWindowStart.toISOString()]
    );

    const sender = await queryOne<Sender>(`SELECT * FROM senders WHERE id = $1`, [senderId]);
    await notifyRateLimitHit({
      tenantId,
      senderEmail: sender?.from_email ?? senderId,
      limit: rate.limit,
      windowCount: rate.limit, // it was at/over the cap
      nextWindowStart: rate.nextWindowStart,
      pushedCount: 1,
    });

    // IMPORTANT: this job is still ACTIVE (currently being processed), so it
    // cannot be removed/re-added under the same id from within its own
    // handler — BullMQ forbids mutating an active job that way, and doing so
    // silently no-ops, which used to leave the email permanently stuck with
    // nothing left in the queue to wake it up.
    //
    // The correct BullMQ pattern for "try again later, same job identity" is
    // for the job to move ITSELF into the delayed state via moveToDelayed(),
    // then signal the worker not to finalize it by throwing DelayedError.
    // This requires the job's active lock token, which the Worker passes in
    // as the second argument to the processor.
    if (token) {
      await job.moveToDelayed(rate.nextWindowStart.getTime(), token);
      throw new DelayedError();
    }

    // Fallback (token unexpectedly missing): re-enqueue as a fresh job. This
    // path should not normally be hit in production BullMQ usage.
    console.warn(`[worker] no active-job token available for ${emailJobId}; re-enqueueing as a fallback`);
    const { enqueueEmailSend } = await import("./emailQueue");
    await enqueueEmailSend(job.data, rate.nextWindowStart);
    return;
  }

  // --- Actually send -------------------------------------------------------
  const sender = await queryOne<Sender>(`SELECT * FROM senders WHERE id = $1`, [senderId]);
  if (!sender) {
    await query(`UPDATE email_jobs SET status = 'failed', error = $2, updated_at = now() WHERE id = $1`, [
      emailJobId,
      "sender not found",
    ]);
    return;
  }

  try {
    const result = await sendEmail(sender, recipientEmail, subject, body);
    const updated = await queryOne<EmailJob>(
      `UPDATE email_jobs
       SET status = 'sent', sent_at = now(), message_id = $2, preview_url = $3, updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [emailJobId, result.messageId, result.previewUrl]
    );
    if (updated) await indexEmail(updated);
    console.log(`[worker] sent ${emailJobId} to ${recipientEmail} — preview: ${result.previewUrl}`);
  } catch (err: any) {
    console.error(`[worker] send failed for ${emailJobId}:`, err.message);
    const updated = await queryOne<EmailJob>(
      `UPDATE email_jobs SET status = 'failed', error = $2, updated_at = now() WHERE id = $1 RETURNING *`,
      [emailJobId, err.message]
    );
    if (updated) await indexEmail(updated);
    throw err; // let BullMQ's retry/backoff policy handle transient SMTP errors
  }
}

export function startEmailWorker(): Worker<EmailJobQueueData> {
  const worker = new Worker<EmailJobQueueData>(EMAIL_QUEUE_NAME, handle, {
    connection: redisConnection,
    concurrency: env.worker.concurrency,
    // Minimum delay between sends, enforced at the queue level (not with an
    // in-handler setTimeout, so it never blocks the event loop or ties up a
    // worker slot). max: 1 job per `minDelayBetweenSendsMs` window.
    limiter: {
      max: 1,
      duration: env.worker.minDelayBetweenSendsMs,
    },
  });

  worker.on("failed", (job, err) => {
    console.error(`[worker] job ${job?.id} failed:`, err.message);
  });

  worker.on("error", (err) => {
    console.error("[worker] worker-level error:", err.message);
  });

  console.log(
    `[worker] started — concurrency=${env.worker.concurrency}, minDelayBetweenSendsMs=${env.worker.minDelayBetweenSendsMs}, maxEmailsPerHourPerSender=${env.worker.maxEmailsPerHourPerSender}`
  );

  return worker;
}
