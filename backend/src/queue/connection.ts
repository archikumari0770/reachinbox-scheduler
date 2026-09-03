import IORedis from "ioredis";
import { env } from "../config/env";

// BullMQ requires maxRetriesPerRequest: null on the connection it manages.
export const redisConnection = new IORedis(env.redisUrl, {
  maxRetriesPerRequest: null,
});

redisConnection.on("error", (err) => {
  console.error("[redis] connection error:", err.message);
});
