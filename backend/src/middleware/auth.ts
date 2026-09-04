import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";

export interface AuthedRequest extends Request {
  userId?: string;
}

// NOTE ON THIS FILE'S HISTORY: this originally used an httpOnly session
// cookie with SameSite=None + Secure for cross-domain use (frontend and
// backend on separate Railway/Vercel subdomains). That is the textbook-
// correct cookie configuration, and it DID work for the Set-Cookie response
// itself — but modern Chrome (especially Incognito) applies "Bounce Tracking
// Protection", which silently refuses to persist cookies set by a domain
// that only ever appears as a redirect intermediary in a navigation chain
// (frontend -> backend -> Google -> backend -> frontend). The backend never
// gets a chance to be treated as a genuine first-party site, so its cookie
// never actually gets stored, regardless of correct SameSite/Secure flags.
//
// Rather than fight increasingly aggressive anti-tracking heuristics, we use
// a bearer token instead: the backend hands the JWT to the frontend directly
// via a URL parameter after login, the frontend stores it (localStorage) and
// sends it back as an `Authorization: Bearer <token>` header on every API
// call. This sidesteps cookie/cross-site restrictions entirely, since it's
// an explicit, visible handoff rather than implicit browser cookie state.

export function signSessionToken(userId: string): string {
  return jwt.sign({ sub: userId }, env.jwtSecret, { expiresIn: "7d" });
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
  if (!token) return res.status(401).json({ error: "Not authenticated" });
  try {
    const payload = jwt.verify(token, env.jwtSecret) as { sub: string };
    req.userId = payload.sub;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired session" });
  }
}
