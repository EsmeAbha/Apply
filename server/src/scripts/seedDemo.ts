/**
 * Optional demo data: runs the real extraction pipeline over the bundled FICTIONAL university pages
 * (test/fixtures) and saves them for one account, flagged isDemo = true and shown as "DEMO DATA".
 *
 *   npm run seed:demo -w server -- --email you@example.com [--password "at least 10 chars"]
 *
 * Nothing here is a real opportunity. Delete demo items from the dashboard at any time.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "../db.js";
import { extractOpportunity } from "../extraction/index.js";
import { hashPassword } from "../security/crypto.js";
import { saveOpportunity } from "../services/opportunities.js";
import { ensureProfile } from "../services/profile.js";

const DEMO_PAGES: [string, string][] = [
  ["uk_funded_studentship", "https://www.cs.northvale.ac.uk/phd/nlp-low-resource-2027"],
  ["de_salaried_position", "https://jobs.tu-lindenberg.de/en/vacancies/4711"],
  ["us_program", "https://cs.eastbrook.edu/phd/admissions"],
  ["conflicting_deadlines", "https://grad.southport.edu.au/phd-scholarships-data-science"],
  ["third_party_listing", "https://www.findaphd.com/phds/project/demo-riverside-computer-vision"],
];

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const email = arg("email")?.toLowerCase();
  if (!email) throw new Error("Usage: npm run seed:demo -w server -- --email you@example.com [--password ...]");
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    const password = arg("password");
    if (!password || password.length < 10) throw new Error(`No account for ${email}. Register in the dashboard first, or pass --password (min 10 chars) to create one.`);
    user = await prisma.user.create({ data: { email, passwordHash: await hashPassword(password) } });
    console.log(`Created account ${email}`);
  }
  await ensureProfile(user.id, email);
  const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../test/fixtures");
  for (const [file, url] of DEMO_PAGES) {
    const html = readFileSync(path.join(fixtures, `${file}.html`), "utf8");
    const ex = extractOpportunity(html, url);
    const r = await saveOpportunity(user.id, ex, { saved: file !== "third_party_listing", discoveredVia: "DEMO", isDemo: true });
    console.log(`${r.created ? "Added" : "Exists"}: [DEMO] ${r.opportunity.title}`);
  }
  console.log("Demo data ready. All demo items are FICTIONAL and labelled DEMO DATA in the dashboard.");
}

main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
