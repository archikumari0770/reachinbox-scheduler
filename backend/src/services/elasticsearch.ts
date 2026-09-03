import { Client } from "@elastic/elasticsearch";
import { env } from "../config/env";
import { EmailJob } from "../types";

const EMAILS_INDEX = "emails";

export const esClient = new Client({ node: env.elasticsearchUrl });

export async function ensureIndex() {
  try {
    const exists = await esClient.indices.exists({ index: EMAILS_INDEX });
    if (!exists) {
      await esClient.indices.create({
        index: EMAILS_INDEX,
        mappings: {
          properties: {
            tenant_id: { type: "keyword" },
            recipient_email: { type: "text" },
            subject: { type: "text" },
            body: { type: "text" },
            status: { type: "keyword" },
            scheduled_at: { type: "date" },
            sent_at: { type: "date" },
          },
        },
      });
      console.log(`[elasticsearch] created index "${EMAILS_INDEX}"`);
    }
  } catch (err: any) {
    console.error("[elasticsearch] index setup failed (search will be degraded):", err.message);
  }
}

/** Upsert so re-indexing the same email job is idempotent. */
export async function indexEmail(job: EmailJob) {
  try {
    await esClient.index({
      index: EMAILS_INDEX,
      id: job.id,
      document: {
        tenant_id: job.tenant_id,
        recipient_email: job.recipient_email,
        subject: job.subject,
        body: job.body,
        status: job.status,
        scheduled_at: job.scheduled_at,
        sent_at: job.sent_at,
      },
    });
  } catch (err: any) {
    // Search is a nice-to-have; never let ES downtime break email sending.
    console.error("[elasticsearch] failed to index email", job.id, err.message);
  }
}

export async function searchEmails(tenantId: string, q: string) {
  try {
    const result = await esClient.search({
      index: EMAILS_INDEX,
      query: {
        bool: {
          must: [{ multi_match: { query: q, fields: ["subject", "body", "recipient_email"] } }],
          filter: [{ term: { tenant_id: tenantId } }],
        },
      },
      size: 50,
    });
    return result.hits.hits.map((h: any) => ({ id: h._id, ...h._source }));
  } catch (err: any) {
    console.error("[elasticsearch] search failed:", err.message);
    return [];
  }
}
