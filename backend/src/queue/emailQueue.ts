import { Queue } from "bullmq";
import { redisConnection } from "./connection";
import { EmailJobQueueData } from "../types";

export const EMAIL_QUEUE_NAME = "email-send";

export const emailQueue = new Queue<EmailJobQueueData>(EMAIL_QUEUE_NAME, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: { age: 60 * 60 * 24 * 7 }, // keep 7 days for Bull-Board visibility
    removeOnFail: { age: 60 * 60 * 24 * 30 },
  },
});

/**
 * Enqueue (or re-enqueue) a delayed send for an email job.
 *
 * jobId === emailJobId is the idempotency key: BullMQ will not create a
 * second job with the same id, so calling this twice for the same email
 * (e.g. from the API and again from the boot-time reconciler) is always safe.
 */
export async function enqueueEmailSend(data: EmailJobQueueData, whenToSend: Date) {
  const delay = Math.max(0, whenToSend.getTime() - Date.now());
  await emailQueue.add("send", data, {
    jobId: data.emailJobId,
    delay,
  });
}

// NOTE: rate-limit rescheduling is handled inside queue/worker.ts via
// job.moveToDelayed() + DelayedError, NOT by removing and re-adding a job
// under the same id — a job cannot safely mutate/remove itself under its own
// id while it's still "active" (currently being processed). See worker.ts
// for details on why that approach is correct and this one isn't.
