import type { Education, Profile, ProfileItem, ResearchInterest } from "@prisma/client";
import { prisma } from "../db.js";

export const DEFAULT_NOTIFICATION_PREFS = { inApp: true, browser: true, email: false, thresholds: [30, 14, 7, 3, 1] };

export const DEFAULT_RESEARCH_INTERESTS = [
  "Machine Learning", "Deep Learning", "Artificial Intelligence", "Large Language Models", "Natural Language Processing",
  "Conversational AI", "Self-supervised Learning", "Low-resource Languages", "Data Science", "Cybersecurity",
  "Dependable and Secure Computing", "Intelligent Systems",
];

export interface ProfileBundle {
  profile: Profile;
  education: Education[];
  interests: ResearchInterest[];
  items: ProfileItem[];
}

/** Create the master profile with the user's stated academic direction (all fields remain editable). */
export async function ensureProfile(userId: string, email?: string): Promise<Profile> {
  const existing = await prisma.profile.findUnique({ where: { userId } });
  if (existing) return existing;
  const profile = await prisma.profile.create({
    data: {
      userId,
      contactEmail: email,
      currentDegree: "Master's in Intelligent Systems (in progress)",
      field: "Computer Science and Engineering (CSE)",
      ieltsStatus: "NOT_TAKEN",
      notificationPrefs: DEFAULT_NOTIFICATION_PREFS,
    },
  });
  await prisma.researchInterest.createMany({
    data: DEFAULT_RESEARCH_INTERESTS.map((name, i) => ({ userId, name, priority: DEFAULT_RESEARCH_INTERESTS.length - i })),
  });
  return profile;
}

export async function getProfileBundle(userId: string): Promise<ProfileBundle> {
  const profile = await ensureProfile(userId);
  const [education, interests, items] = await Promise.all([
    prisma.education.findMany({ where: { profileId: profile.id }, orderBy: { sortOrder: "asc" } }),
    prisma.researchInterest.findMany({ where: { userId }, orderBy: { priority: "desc" } }),
    prisma.profileItem.findMany({ where: { userId }, orderBy: { createdAt: "desc" } }),
  ]);
  return { profile, education, interests, items };
}

/** Text of everything the user has verified about themselves — the only allowed basis for generated documents. */
export function verifiedProfileText(b: ProfileBundle): string {
  const p = b.profile;
  const lines: string[] = [];
  const push = (...xs: (string | null | undefined)[]) => lines.push(xs.filter(Boolean).join(" — "));
  push(p.fullName, p.contactEmail, p.phone);
  push(p.currentDegree, p.field);
  push(p.summary);
  for (const e of b.education.filter((x) => x.verified)) push(e.degree, e.field, e.institution, e.country, e.startDate, e.endDate, e.grade, e.thesisTitle, e.mediumOfInstruction);
  push("Research interests:", b.interests.map((i) => i.name).join(", "));
  push("Skills:", (p.skills as string[]).join(", "));
  push("Programming:", (p.programmingLanguages as string[]).join(", "));
  for (const it of b.items.filter((x) => x.verified)) push(it.kind, it.title, it.organization, it.startDate, it.endDate, it.description, it.url);
  if (p.masterSop) lines.push(p.masterSop);
  if (p.masterCoverLetter) lines.push(p.masterCoverLetter);
  return lines.filter((l) => l.trim()).join("\n");
}
