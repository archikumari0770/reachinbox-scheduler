import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";

export interface AuthedRequest extends Request {
  userId?: string;
}

const COOKIE_NAME = "reachinbox_session";

// In production, frontend and backend live on different domains (e.g. two
// separate Railway/Vercel subdomains), so the session cookie must be marked
// SameSite=None + Secure to be sent on cross-domain API calls at all — a
// browser requirement, not optional. Locally, frontend and backend are both
// on "localhost" (just different ports), which browsers treat as the same
// site, so SameSite=Lax works fine there. We switch based on NODE_ENV so the
// same code works correctly in both environments without manual toggling.
const isProduction = process.env.NODE_ENV === "production";
const cookieOptions = {
  httpOnly: true,
  sameSite: (isProduction ? "none" : "lax") as "none" | "lax",
  secure: isProduction, // SameSite=None requires Secure — browsers reject it otherwise
};

export function issueSessionCookie(res: Response, userId: string) {
  const token = jwt.sign({ sub: userId }, env.jwtSecret, { expiresIn: "7d" });
  res.cookie(COOKIE_NAME, token, {
    ...cookieOptions,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

export function clearSessionCookie(res: Response) {
  // clearCookie must be called with matching attributes (sameSite/secure) or
  // some browsers won't actually clear a cookie that was set with them.
  res.clearCookie(COOKIE_NAME, cookieOptions);
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return res.status(401).json({ error: "Not authenticated" });
  try {
    const payload = jwt.verify(token, env.jwtSecret) as { sub: string };
    req.userId = payload.sub;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired session" });
  }
}
