import { execSync } from "node:child_process";
import { rmSync } from "node:fs";

export default function setup() {
  rmSync("prisma/test.db", { force: true });
  rmSync("test-storage", { recursive: true, force: true });
  execSync("npx prisma db push --skip-generate --accept-data-loss", {
    env: { ...process.env, DATABASE_URL: "file:./test.db" },
    stdio: "ignore",
  });
  return () => {
    rmSync("test-storage", { recursive: true, force: true });
  };
}
