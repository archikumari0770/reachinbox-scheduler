import axios from "axios";
import { EmailJob, MeResponse } from "@/types";

export const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export const api = axios.create({
  baseURL: API_URL,
  withCredentials: true,
});

export async function fetchMe(): Promise<MeResponse> {
  const { data } = await api.get<MeResponse>("/api/auth/me");
  return data;
}

export async function logout(): Promise<void> {
  await api.post("/api/auth/logout");
}

export async function fetchScheduled(): Promise<EmailJob[]> {
  const { data } = await api.get<{ emails: EmailJob[] }>("/api/emails/scheduled");
  return data.emails;
}

export async function fetchSent(): Promise<EmailJob[]> {
  const { data } = await api.get<{ emails: EmailJob[] }>("/api/emails/sent");
  return data.emails;
}

export async function searchEmails(q: string): Promise<EmailJob[]> {
  const { data } = await api.get<{ emails: EmailJob[] }>("/api/emails/search", { params: { q } });
  return data.emails;
}

export interface ScheduleResponse {
  batchId: string;
  scheduledCount: number;
}

export async function scheduleEmails(form: FormData): Promise<ScheduleResponse> {
  const { data } = await api.post<ScheduleResponse>("/api/emails/schedule", form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}

export function googleLoginUrl(): string {
  return `${API_URL}/api/auth/google`;
}

export function slackConnectUrl(): string {
  return `${API_URL}/api/slack/authorize`;
}

export async function disconnectSlack(): Promise<void> {
  await api.post("/api/slack/disconnect");
}
