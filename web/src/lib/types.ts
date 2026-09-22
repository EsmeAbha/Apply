export type Certainty = "VERIFIED" | "LIKELY" | "POSSIBLE" | "UNKNOWN" | "CONFLICTING" | "USER_ENTERED";
export type Urgency = "CRITICAL" | "URGENT" | "SOON" | "UPCOMING" | "LATER" | "CLOSED" | "UNKNOWN";

export interface Evidence {
  sourceUrl: string;
  sourceTitle?: string;
  sourceType: string;
  snippet: string;
  accessedAt: string;
  method: string;
}
export interface Fact<T> {
  value: T | null;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  certainty: Certainty;
  evidence: Evidence[];
  note?: string;
}
export interface Money { amount: number; currency: string; period?: string; text: string }
export interface DeadlineFact {
  kind: string; date: string | null; dateText: string; time?: string; timezone?: string; round?: string;
  rolling: boolean; yearInferred: boolean; ambiguousFormat?: boolean; confidence: string; certainty: Certainty; evidence: Evidence[]; note?: string;
}
export interface DocumentRequirement {
  key: string; label: string; necessity: string; count?: number; format?: string; maxPages?: number; maxWords?: number; maxSizeMb?: number;
  instructions?: string; confidence: string; certainty: Certainty; evidence: Evidence[];
}
export interface Extraction {
  url: string; normalizedUrl: string; pageTitle: string; sourceType: string; sourceTypeReason: string; accessedAt: string;
  isLikelyOpportunity: boolean; opportunitySignals: string[];
  title: Fact<string>; university: Fact<string>; department: Fact<string>; country: Fact<string>; city: Fact<string>;
  positionType: Fact<string>; researchAreas: string[]; applyUrl: Fact<string>; supervisorRequired: Fact<boolean>;
  supervisors: { name: string; title?: string; email?: string; evidence: Evidence[] }[];
  positionStatus: Fact<string>; rolling: Fact<boolean>; deadlines: DeadlineFact[];
  funding: {
    category: Fact<string>; tuition: Fact<string>; stipend: Fact<Money>; salary: Fact<string>; duration: Fact<string>;
    benefits: { benefit: string; evidence: Evidence[] }[]; fundingSource: Fact<string>; guaranteed: Fact<string>; positions: Fact<number>;
  };
  fee: { status: Fact<string>; amount: Fact<Money>; waiver: Fact<string>; waiverEligibility?: string; otherMandatoryCosts: { label: string; amount?: Money; evidence: Evidence[] }[] };
  english: {
    status: Fact<string>; stage: Fact<string>; tests: { test: string; minOverall?: number; minSection?: number; evidence: Evidence[] }[];
    waivers: { reason: string; text: string; evidence: Evidence[] }[]; canApplyBeforeResult: Fact<boolean>; conditionalAdmission: Fact<boolean>; summary: string;
  };
  documents: DocumentRequirement[];
  degreeRequirement: Fact<string>;
  conflicts: { field: string; label: string; values: { value: string; evidence: Evidence[] }[]; action: string }[];
  warnings: string[];
  summary: string;
}
export interface OpportunitySummary {
  id: string; title: string; universityName: string | null; department: string | null; country: string | null; city: string | null;
  positionType: string; researchAreas: string[]; officialUrl: string; applyUrl: string | null; sourceType: string; sourceLabel: string;
  status: string; fundingCategory: string; tuition: string; stipend: string | null; salary: string | null;
  feeStatus: string; feeAmount: number | null; feeCurrency: string | null; feeWaiver: string | null; otherMandatoryCosts: string[];
  englishStatus: string; englishSummary: string; englishWaiverPossible: boolean; verificationStatus: string; supervisorRequired: string;
  primaryDeadline: string | null; daysRemaining: number | null; urgency: Urgency; rolling: boolean;
  requiredDocuments: { key: string; label: string }[]; saved: boolean; shortlisted: boolean; archived: boolean; isDemo: boolean;
  discoveredVia: string; lastVerifiedAt: string | null; createdAt: string; conflictCount: number;
  applicationId: string | null; applicationStage: string | null; pendingChanges?: number; researchAlignment?: string;
}
export interface ChangeLog { id: string; field: string; label: string; oldValue: string | null; newValue: string | null; sourceUrl: string; snippet: string | null; status: string; detectedAt: string }
export interface Supervisor { id: string; name: string; title: string | null; department: string | null; email: string | null; researchAreas: string[]; profileUrl: string | null; sourceUrl: string; snippet: string | null; relevance: number }
export interface OpportunityDetail extends OpportunitySummary {
  extraction: Extraction;
  sources: { id: string; url: string; title: string | null; sourceType: string; accessedAt: string; lastVerifiedAt: string }[];
  changes: ChangeLog[];
  supervisors: Supervisor[];
}
export interface MatchAnalysis {
  researchAlignment: { level: string; matched: string[]; explanation: string };
  degreeCompatibility: { level: string; explanation: string; requirementQuote?: string };
  technicalSkills: { matched: string[]; explanation: string };
  publicationAlignment: { matched: string[]; explanation: string };
  experienceAlignment: { matched: string[]; explanation: string };
  english: { status: string; userStatus: string; explanation: string; action: string };
  funding: string; applicationCost: string; deadline: string; disclaimer: string;
}
export interface Profile {
  id: string; fullName: string | null; contactEmail: string | null; phone: string | null; address: string | null; nationality: string | null;
  dateOfBirth: string | null; timezone: string; currentDegree: string | null; field: string | null; summary: string | null;
  skills: string[]; programmingLanguages: string[]; languages: { language: string; level: string }[];
  englishMediumEducation: string; englishMediumEvidence: string | null; ieltsStatus: string; ieltsTestDate: string | null;
  ieltsScores: { overall?: number | null; listening?: number | null; reading?: number | null; writing?: number | null; speaking?: number | null } | null;
  otherTests: { test: string; score: string; date?: string }[]; preferredCountries: string[];
  notificationPrefs: { inApp: boolean; browser: boolean; email: boolean; thresholds: number[] } | null;
  masterSop: string | null; masterCoverLetter: string | null;
}
export interface Education { id: string; degree: string; field: string | null; institution: string; country: string | null; startDate: string | null; endDate: string | null; status: string; grade: string | null; thesisTitle: string | null; mediumOfInstruction: string | null; verified: boolean }
export interface ProfileItem { id: string; kind: string; title: string; organization: string | null; startDate: string | null; endDate: string | null; description: string | null; url: string | null; verified: boolean }
export interface ProfileBundle { profile: Profile; education: Education[]; interests: { id: string; name: string }[]; items: ProfileItem[] }
export interface DocVersion { id: string; versionNumber: number; label: string; originalName: string; mimeType: string; sizeBytes: number; createdAt: string; notes: string | null; sha256: string }
export interface VaultDocument { id: string; name: string; type: string; language: string | null; relevantProgram: string | null; status: string; sensitive: boolean; notes: string | null; documentDate: string | null; createdAt: string; updatedAt: string; versions: DocVersion[] }
export interface AppDocument { id: string; requirementKey: string; label: string; necessity: string; status: string; documentVersionId: string | null; generatedDocumentId: string | null; count: number | null; countReady: number | null; notes: string | null; documentVersion?: { id: string; label: string; originalName: string } | null }
export interface ChecklistItem { key: string; label: string; done: boolean; auto: boolean; detail: string; confirmedByUser?: boolean }
export interface Generated { id: string; kind: string; tone: string | null; title: string; content: string; baseContent: string | null; changes: { section: string; original: string; customized: string; reason: string }[]; warnings: { claim: string; kind: string; message: string }[]; provider: string; status: string; version: number; createdAt: string; updatedAt: string; opportunity?: { id: string; title: string; universityName: string | null } | null }
export interface EmailDraft { id: string; purpose: string; to: string | null; subject: string; body: string; warnings: { claim: string; message: string }[]; status: string; createdAt: string; opportunity?: { id: string; title: string } | null; supervisor?: { id: string; name: string } | null }
export interface Task { id: string; title: string; notes: string | null; dueDate: string | null; done: boolean; kind: string; opportunity?: { id: string; title: string } | null }
export interface Notification { id: string; type: string; severity: string; title: string; body: string; link: string | null; readAt: string | null; createdAt: string }
export interface DeadlineRow { id: string; kind: string; date: string | null; dateText: string; time: string | null; timezone: string | null; round: string | null; certainty: string; yearInferred: boolean; snippet: string; sourceUrl: string; daysRemaining: number | null; urgency: Urgency; opportunity: { id: string; title: string; universityName: string | null; country: string | null; applications: { id: string; stage: string }[] } }
