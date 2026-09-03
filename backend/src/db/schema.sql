-- ReachInbox Mini schema
CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- for gen_random_uuid()

-- A "tenant" is just the logged-in user's own account in this reference impl:
-- every user is the sole owner of their senders / integrations / email jobs.
CREATE TABLE IF NOT EXISTS users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  google_id       TEXT UNIQUE NOT NULL,
  email           TEXT NOT NULL,
  name            TEXT NOT NULL,
  avatar_url      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS senders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  from_email      TEXT NOT NULL,
  smtp_host       TEXT NOT NULL DEFAULT 'smtp.ethereal.email',
  smtp_port       INTEGER NOT NULL DEFAULT 587,
  smtp_user       TEXT NOT NULL,
  smtp_pass       TEXT NOT NULL,
  is_default      BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS slack_integrations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  team_name       TEXT NOT NULL,
  webhook_url     TEXT NOT NULL,
  access_token    TEXT NOT NULL,
  connected_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS email_batches (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject         TEXT NOT NULL,
  body            TEXT NOT NULL,
  recipient_count INTEGER NOT NULL DEFAULT 0,
  start_time      TIMESTAMPTZ NOT NULL,
  delay_ms        INTEGER NOT NULL,
  hourly_limit    INTEGER NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS email_jobs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  batch_id          UUID REFERENCES email_batches(id) ON DELETE CASCADE,
  sender_id         UUID NOT NULL REFERENCES senders(id),
  recipient_email   TEXT NOT NULL,
  subject           TEXT NOT NULL,
  body              TEXT NOT NULL,
  scheduled_at      TIMESTAMPTZ NOT NULL,
  status            TEXT NOT NULL DEFAULT 'scheduled'
                      CHECK (status IN ('scheduled','processing','sent','failed','cancelled')),
  attempts          INTEGER NOT NULL DEFAULT 0,
  error             TEXT,
  sent_at           TIMESTAMPTZ,
  message_id        TEXT,
  preview_url       TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_jobs_tenant_status ON email_jobs(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_email_jobs_scheduled_at ON email_jobs(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_email_jobs_sender ON email_jobs(sender_id);
