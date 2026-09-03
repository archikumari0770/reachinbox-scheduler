import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { env } from "./config/env";
import authRoutes from "./routes/auth";
import slackRoutes from "./routes/slack";
import emailRoutes from "./routes/emails";
import { requireAuth } from "./middleware/auth";
import { mountBullBoard } from "./queue/board";
import { startEmailWorker } from "./queue/worker";
import { reconcileScheduledJobs } from "./queue/reconcile";
import { ensureIndex } from "./services/elasticsearch";

async function main() {
  const app = express();

  app.use(cors({ origin: env.frontendUrl, credentials: true }));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  app.get("/health", (_req, res) => res.json({ ok: true }));

  app.use("/api/auth", authRoutes);
  app.use("/api/slack", slackRoutes);
  app.use("/api/emails", emailRoutes);

  // Live BullMQ dashboard — protected by the same session cookie auth as the rest of the API.
  app.use("/admin/queues", requireAuth, mountBullBoard("/admin/queues"));

  await ensureIndex();
  await reconcileScheduledJobs(); // one-shot self-heal pass, NOT a cron loop
  startEmailWorker();

  app.listen(env.port, () => {
    console.log(`[server] listening on http://localhost:${env.port}`);
    console.log(`[server] Bull-Board:  http://localhost:${env.port}/admin/queues`);
  });
}

main().catch((err) => {
  console.error("[server] fatal startup error:", err);
  process.exit(1);
});
