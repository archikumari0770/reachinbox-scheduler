import dotenv from "dotenv";
dotenv.config();

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) {
    // Don't throw at import time for optional integrations (Google/Slack) —
    // routes that need them check individually so the app still boots for
    // local exploration without every credential configured.
    return "";
  }
  return v;
}

export const env = {
  port: parseInt(process.env.PORT || "4000", 10),
  frontendUrl: required("FRONTEND_URL", "http://localhost:3000"),
  backendUrl: required("BACKEND_URL", "http://localhost:4000"),

  databaseUrl: required("DATABASE_URL", "postgres://reachinbox:reachinbox@localhost:5432/reachinbox"),
  redisUrl: required("REDIS_URL", "redis://localhost:6379"),
  elasticsearchUrl: required("ELASTICSEARCH_URL", "http://localhost:9200"),

  sessionSecret: required("SESSION_SECRET", "dev-session-secret"),
  jwtSecret: required("JWT_SECRET", "dev-jwt-secret"),

  google: {
    clientId: required("GOOGLE_CLIENT_ID"),
    clientSecret: required("GOOGLE_CLIENT_SECRET"),
    callbackUrl: required("GOOGLE_CALLBACK_URL", "http://localhost:4000/api/auth/google/callback"),
  },

  slack: {
    clientId: required("SLACK_CLIENT_ID"),
    clientSecret: required("SLACK_CLIENT_SECRET"),
    redirectUri: required("SLACK_REDIRECT_URI", "http://localhost:4000/api/slack/callback"),
  },

  ethereal: {
    user: process.env.ETHEREAL_SMTP_USER || "",
    pass: process.env.ETHEREAL_SMTP_PASS || "",
  },

  worker: {
    concurrency: parseInt(process.env.WORKER_CONCURRENCY || "5", 10),
    minDelayBetweenSendsMs: parseInt(process.env.MIN_DELAY_BETWEEN_SENDS_MS || "2000", 10),
    maxEmailsPerHourPerSender: parseInt(process.env.MAX_EMAILS_PER_HOUR_PER_SENDER || "200", 10),
  },
};
