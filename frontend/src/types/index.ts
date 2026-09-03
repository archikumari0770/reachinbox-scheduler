export type EmailStatus = "scheduled" | "processing" | "sent" | "failed" | "cancelled";

export interface User {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
}

export interface Sender {
  id: string;
  name: string;
  from_email: string;
  is_default: boolean;
}

export interface EmailJob {
  id: string;
  recipient_email: string;
  subject: string;
  body: string;
  scheduled_at: string;
  status: EmailStatus;
  attempts: number;
  error: string | null;
  sent_at: string | null;
  preview_url: string | null;
}

export interface MeResponse {
  user: User;
  senders: Sender[];
  slackConnected: boolean;
  slack?: { team_name: string; connected_at: string } | null;
}

export interface ScheduleFormValues {
  subject: string;
  body: string;
  recipientsText: string;
  file: File | null;
  startTime: string; // datetime-local value
  delaySeconds: number;
  hourlyLimit: number;
}
