import { Router } from "express";
import { z } from "zod";
import { createSession, requireAuth, uid } from "../auth/middleware.js";
import { prisma } from "../db.js";
import { ah, HttpError } from "../http.js";
import { hashPassword, sha256Hex, verifyPassword } from "../security/crypto.js";
import { ensureProfile } from "../services/profile.js";

export const authRouter = Router();

const credentials = z.object({
  email: z.string().email().max(200).transform((s) => s.toLowerCase().trim()),
  password: z.string().min(10, "Password must be at least 10 characters").max(200),
  client: z.enum(["web", "extension"]).optional(),
});

// Simple in-memory brute-force protection.
const failures = new Map<string, { count: number; until: number }>();
function checkThrottle(key: string) {
  const f = failures.get(key);
  if (f && f.until > Date.now()) throw new HttpError(429, "Too many failed attempts. Try again in a few minutes.");
}
function recordFailure(key: string) {
  const f = failures.get(key) ?? { count: 0, until: 0 };
  f.count++;
  if (f.count >= 5) {
    f.until = Date.now() + 5 * 60_000;
    f.count = 0;
  }
  failures.set(key, f);
}

authRouter.post(
  "/register",
  ah(async (req, res) => {
    const body = credentials.parse(req.body);
    const exists = await prisma.user.findUnique({ where: { email: body.email } });
    if (exists) throw new HttpError(409, "An account with this email already exists");
    const user = await prisma.user.create({ data: { email: body.email, passwordHash: await hashPassword(body.password) } });
    await ensureProfile(user.id, user.email);
    const token = await createSession(user.id, body.client ?? "web");
    res.status(201).json({ token, user: { id: user.id, email: user.email } });
  }),
);

authRouter.post(
  "/login",
  ah(async (req, res) => {
    const body = credentials.extend({ password: z.string().min(1).max(200) }).parse(req.body);
    const key = `${req.ip}:${body.email}`;
    checkThrottle(key);
    const user = await prisma.user.findUnique({ where: { email: body.email } });
    if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
      recordFailure(key);
      throw new HttpError(401, "Invalid email or password");
    }
    failures.delete(key);
    const token = await createSession(user.id, body.client ?? "web");
    res.json({ token, user: { id: user.id, email: user.email } });
  }),
);

authRouter.post(
  "/logout",
  requireAuth,
  ah(async (req, res) => {
    const token = (req.header("authorization") ?? "").slice(7);
    await prisma.session.deleteMany({ where: { tokenHash: sha256Hex(token) } });
    res.json({ ok: true });
  }),
);

authRouter.get(
  "/me",
  requireAuth,
  ah(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: uid(req) }, select: { id: true, email: true, createdAt: true } });
    res.json({ user });
  }),
);
