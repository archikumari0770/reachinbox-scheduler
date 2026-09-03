import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import { emailQueue } from "./emailQueue";

export function mountBullBoard(basePath: string) {
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath(basePath);

  createBullBoard({
    // Minor type-version mismatch between bullmq's Job typings and
    // @bull-board/api's expected shape; functionality is unaffected.
    queues: [new BullMQAdapter(emailQueue) as any],
    serverAdapter,
  });

  return serverAdapter.getRouter();
}
