export type EmailStatus = "scheduled" | "processing" | "sent" | "failed" | "cancelled";

export interface User {
  id: string;
  google_id: string;
  email: string;
  name: string;
  avatar_url: string | null;
  created_at: string;
}

export interface Sender {
  id: string;
  tenant_id: string;
  name: string;
  from_email: string;
  smtp_host: string;
  smtp_port: number;
  smtp_user: string;
  smtp_pass: string;
  is_default: boolean;
}

export interface SlackIntegration {
  id: string;
  tenant_id: string;
  team_name: string;
  webhook_url: string;
  access_token: string;
  connected_at: string;
}

export interface EmailJob {
  id: string;
  tenant_id: string;
  batch_id: string | null;
  sender_id: string;
  recipient_email: string;
  subject: string;
  body: string;
  scheduled_at: string;
  status: EmailStatus;
  attempts: number;
  error: string | null;
  sent_at: string | null;
  message_id: string | null;
  preview_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface EmailJobQueueData {
  emailJobId: string;
  tenantId: string;
  senderId: string;
  recipientEmail: string;
  subject: string;
  body: string;
  hourlyLimit?: number; // per-batch override of MAX_EMAILS_PER_HOUR_PER_SENDER
}

export interface ScheduleEmailRequest {
  subject: string;
  body: string;
  recipients: string[];
  startTime: string; // ISO
  delayMs: number; // delay between each email in the batch
  hourlyLimit?: number; // optional override, falls back to env default
}
