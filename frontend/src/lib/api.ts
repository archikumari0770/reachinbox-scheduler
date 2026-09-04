import axios from "axios";
import { EmailJob, MeResponse } from "@/types";

export const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

const TOKEN_KEY = "reachinbox_token";

// Session is stored as a bearer token in localStorage rather than a cookie.
// This is deliberate: with frontend and backend on separate domains (e.g.
// two different Railway/Vercel subdomains), Chrome's Bounce Tracking
// Protection silently refuses to persist cookies set by a domain that only
// ever appears as a redirect intermediary (frontend -> backend -> Google ->
// backend -> frontend) — even with fully correct SameSite=None; Secure
// attributes. A token handed off explicitly via URL and stored client-side
// sidesteps that entirely. See backend/src/middleware/auth.ts for the other
// half of this.

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  window.localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  window.localStorage.removeItem(TOKEN_KEY);
}

export const api = axios.create({
  baseURL: API_URL,
});

// Attach the bearer token (if we have one) to every outgoing request.
api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export async function fetchMe(): Promise<MeResponse> {
  const { data } = await api.get<MeResponse>("/api/auth/me");
  return data;
}

export async function logout(): Promise<void> {
  clearToken();
  // Best-effort notify the backend too; failure here doesn't matter since
  // there's no server-side session left to worry about either way.
  try {
    await api.post("/api/auth/logout");
  } catch {
    /* no-op */
  }
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
