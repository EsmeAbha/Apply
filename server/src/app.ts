import cors from "cors";
import express from "express";
import helmet from "helmet";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { requireAuth } from "./auth/middleware.js";
import { config } from "./config.js";
import { errorHandler } from "./http.js";
import { applicationsRouter } from "./routes/applications.js";
import { authRouter } from "./routes/auth.js";
import { documentsRouter } from "./routes/documents.js";
import { opportunitiesRouter } from "./routes/opportunities.js";
import { profileRouter } from "./routes/profile.js";
import { workspaceRouter } from "./routes/workspace.js";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", "loopback");
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: "same-site" } }));
  app.use(
    cors({
      origin(origin, cb) {
        // Same-origin requests, the dashboard origin(s) and the browser extension are allowed.
        if (!origin || config.corsOrigins.includes(origin) || origin.startsWith("chrome-extension://")) return cb(null, true);
        cb(new Error("Origin not allowed by CORS"));
      },
      allowedHeaders: ["Content-Type", "Authorization"],
      exposedHeaders: ["Content-Disposition"],
    }),
  );
  app.use(express.json({ limit: "8mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, name: "PhD Application Intelligence Assistant", time: new Date().toISOString() });
  });
  app.use("/api/auth", authRouter);
  app.use("/api", requireAuth, opportunitiesRouter, applicationsRouter, documentsRouter, profileRouter, workspaceRouter);
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  // Serve the built dashboard in production (npm run build).
  const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../web/dist");
  if (existsSync(webDist)) {
    app.use(express.static(webDist));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(webDist, "index.html")));
  }

  app.use(errorHandler);
  return app;
}
