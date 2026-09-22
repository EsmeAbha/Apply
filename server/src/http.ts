import type { NextFunction, Request, RequestHandler, Response } from "express";
import { ZodError } from "zod";

export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

/** Wrap async route handlers so rejections reach the error middleware. */
export const ah =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, details: err.details });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({ error: "Invalid request", details: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`) });
    return;
  }
  const e = err as Error & { code?: string };
  if (e?.code === "LIMIT_FILE_SIZE") {
    res.status(413).json({ error: "File too large (max 25 MB)" });
    return;
  }
  // Never log request bodies (they may contain passwords or document contents).
  console.error("[error]", e?.message ?? e);
  res.status(500).json({ error: "Internal server error" });
}
