import type { NextFunction, Request, Response } from "express";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { randomToken, sha256Hex } from "../security/crypto.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

export async function createSession(userId: string, label = "web"): Promise<string> {
  const token = randomToken();
  await prisma.session.create({
    data: { userId, tokenHash: sha256Hex(token), label, expiresAt: new Date(Date.now() + config.sessionDays * 86_400_000) },
  });
  return token;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const session = await prisma.session.findUnique({ where: { tokenHash: sha256Hex(token) } });
  if (!session || session.expiresAt < new Date()) {
    res.status(401).json({ error: "Session expired — please sign in again" });
    return;
  }
  req.userId = session.userId;
  // Touch at most once per hour to avoid a write per request.
  if (Date.now() - session.lastUsedAt.getTime() > 3_600_000) {
    await prisma.session.update({ where: { id: session.id }, data: { lastUsedAt: new Date() } });
  }
  next();
}

export function uid(req: Request): string {
  if (!req.userId) throw new Error("requireAuth middleware missing");
  return req.userId;
}
