/**
 * Core extraction types. Every factual field carries evidence (source URL + verbatim snippet)
 * and a certainty level. A field without evidence is `null` → rendered as UNKNOWN.
 */

export type SourceType =
  | "OFFICIAL_UNIVERSITY"
  | "INSTITUTIONAL_PORTAL" // recruitment systems universities publish through (e.g. Jobbnorge, Varbi)
  | "GOVERNMENT"
  | "THIRD_PARTY"
  | "UNKNOWN"
  | "USER_ENTERED";

export type Confidence = "HIGH" | "MEDIUM" | "LOW";

export type Certainty = "VERIFIED" | "LIKELY" | "POSSIBLE" | "UNKNOWN" | "CONFLICTING" | "USER_ENTERED";

export interface Evidence {
  sourceUrl: string;
  sourceTitle?: string;
  sourceType: SourceType;
  snippet: string;
  accessedAt: string; // ISO timestamp
  method: "RULE" | "STRUCTURED_DATA" | "AI_QUOTE_VERIFIED" | "USER";
}

export interface Fact<T> {
  value: T | null;
  confidence: Confidence;
  certainty: Certainty;
  evidence: Evidence[];
  note?: string;
}

export type DeadlineKind =
  | "APPLICATION"
  | "FUNDING"
  | "SCHOLARSHIP"
  | "DEPARTMENT"
  | "SUPERVISOR_CONTACT"
  | "OPENING"
  | "START_DATE"
  | "OTHER";

export interface DeadlineFact {
  kind: DeadlineKind;
  date: string | null; // YYYY-MM-DD
  dateText: string;
  time?: string;
  timezone?: string;
  round?: string;
  rolling: boolean;
  yearInferred: boolean;
  ambiguousFormat?: boolean;
  confidence: Confidence;
  certainty: Certainty;
  evidence: Evidence[];
  note?: string;
}

export type FundingCategory =
  | "FULLY_FUNDED"
  | "PARTIALLY_FUNDED"
  | "SALARIED_POSITION"
  | "SCHOLARSHIP_AVAILABLE"
  | "FUNDING_COMPETITIVE"
  | "SELF_FUNDED"
  | "FUNDING_UNKNOWN";

export interface MoneyAmount {
  amount: number;
  currency: string; // ISO code
  period?: "MONTH" | "YEAR" | "TOTAL";
  text: string;
}

export interface FundingInfo {
  category: Fact<FundingCategory>;
  tuition: Fact<"COVERED" | "PARTIAL" | "NOT_COVERED">;
  stipend: Fact<MoneyAmount>;
  salary: Fact<string>;
  duration: Fact<string>;
  benefits: { benefit: string; evidence: Evidence[] }[];
  fundingSource: Fact<string>;
  guaranteed: Fact<"GUARANTEED" | "COMPETITIVE">;
  positions: Fact<number>;
}

export type FeeStatus = "FREE" | "FEE_REQUIRED" | "UNKNOWN";

export interface FeeInfo {
  status: Fact<FeeStatus>;
  amount: Fact<MoneyAmount>;
  waiver: Fact<"AVAILABLE" | "NOT_AVAILABLE">;
  waiverEligibility?: string;
  otherMandatoryCosts: { label: string; amount?: MoneyAmount; evidence: Evidence[] }[];
}

export type EnglishStatus =
  | "REQUIRED_AT_APPLICATION"
  | "REQUIRED_LATER"
  | "NOT_REQUIRED"
  | "WAIVER_POSSIBLE"
  | "REQUIRED_STAGE_UNCLEAR"
  | "NEEDS_VERIFICATION"
  | "UNKNOWN";

export type RequirementStage = "APPLICATION" | "AFTER_ADMISSION" | "BEFORE_ENROLMENT" | "UNKNOWN";

export interface EnglishTestRequirement {
  test: "IELTS" | "TOEFL" | "DUOLINGO" | "PTE" | "CAMBRIDGE" | "OTHER";
  minOverall?: number;
  minSection?: number;
  sectionNote?: string;
  evidence: Evidence[];
}

export interface EnglishInfo {
  status: Fact<EnglishStatus>;
  stage: Fact<RequirementStage>;
  tests: EnglishTestRequirement[];
  waivers: { reason: "ENGLISH_MEDIUM_DEGREE" | "NATIVE_SPEAKER_COUNTRY" | "UNIVERSITY_DISCRETION" | "OTHER"; text: string; evidence: Evidence[] }[];
  canApplyBeforeResult: Fact<boolean>;
  conditionalAdmission: Fact<boolean>;
  summary: string; // human-readable, e.g. "NOT REQUIRED AT INITIAL APPLICATION — proof required before enrolment"
}

export type Necessity = "REQUIRED" | "OPTIONAL" | "CONDITIONAL" | "NOT_REQUIRED" | "UNKNOWN";

export interface DocumentRequirement {
  key: string; // CV, SOP, MOTIVATION_LETTER, ...
  label: string;
  necessity: Necessity;
  count?: number;
  format?: string;
  maxPages?: number;
  maxWords?: number;
  maxSizeMb?: number;
  instructions?: string;
  confidence: Confidence;
  certainty: Certainty;
  evidence: Evidence[];
}

export interface SupervisorMention {
  name: string;
  title?: string;
  email?: string;
  evidence: Evidence[];
}

export interface Conflict {
  field: string;
  label: string;
  values: { value: string; evidence: Evidence[] }[];
  action: "VERIFY_MANUALLY";
}

export interface ExtractionResult {
  url: string;
  normalizedUrl: string;
  pageTitle: string;
  sourceType: SourceType;
  sourceTypeReason: string;
  accessedAt: string;
  contentHash: string;
  isLikelyOpportunity: boolean;
  opportunitySignals: string[];

  title: Fact<string>;
  university: Fact<string>;
  department: Fact<string>;
  country: Fact<string>;
  city: Fact<string>;
  positionType: Fact<"PHD_POSITION" | "PHD_PROGRAM" | "SCHOLARSHIP" | "FELLOWSHIP">;
  researchAreas: string[];
  applyUrl: Fact<string>;
  supervisorRequired: Fact<boolean>;
  supervisors: SupervisorMention[];
  positionStatus: Fact<"OPEN" | "CLOSED">;
  rolling: Fact<boolean>;

  deadlines: DeadlineFact[];
  funding: FundingInfo;
  fee: FeeInfo;
  english: EnglishInfo;
  documents: DocumentRequirement[];
  degreeRequirement: Fact<string>;

  conflicts: Conflict[];
  warnings: string[];
  summary: string;
}
