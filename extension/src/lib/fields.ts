/**
 * Application-form field classification. Pure functions so they can be unit-tested.
 *
 *  SENSITIVE  → never auto-filled (citizenship, date of birth, declarations, consent, disability/medical,
 *               criminal record, financial information, passwords, signatures…). The user answers these.
 *  MAPPED     → a non-sensitive profile value can be SUGGESTED; it is only filled when the user clicks.
 *  UPLOAD     → file inputs: the user attaches files themselves.
 *  UNMAPPED   → no suggestion.
 */

export type FieldCategory = "SENSITIVE" | "MAPPED" | "UPLOAD" | "UNMAPPED";

export interface FieldDescriptor {
  label: string;
  name?: string;
  id?: string;
  type?: string;
  placeholder?: string;
  autocomplete?: string;
  required?: boolean;
}

export interface Classification {
  category: FieldCategory;
  key?: string;
  reason: string;
}

export type FormValues = Partial<Record<string, string | null>>;

const SENSITIVE: { re: RegExp; reason: string }[] = [
  { re: /password|passcode|\bpin\b|security question/i, reason: "Credentials — enter these yourself" },
  { re: /citizen|nationalit|country of (birth|citizenship)|place of birth/i, reason: "Citizenship / nationality" },
  { re: /date of birth|birth ?date|\bdob\b|\bbirthday\b|\bage\b/i, reason: "Date of birth" },
  { re: /passport (no|number|#)|national id|identity (card|number)|social security|\bssn\b|\btax (id|number)\b|insurance number/i, reason: "Identity document number" },
  { re: /visa|immigration|residence permit|right to (work|study)/i, reason: "Immigration status" },
  { re: /gender|\bsex\b|pronoun|ethnic|\brace\b|religio|sexual orientation|marital|veteran|caste/i, reason: "Personal characteristic (equal-opportunity data)" },
  { re: /disab|medical|health|impairment|accommodation needs|special needs|mental/i, reason: "Disability / medical information" },
  { re: /criminal|convict|offen[cs]e|arrest|prosecut|police record/i, reason: "Criminal / legal declaration" },
  { re: /declar|certify|i confirm|confirm that|attest|true and (complete|correct)|i agree|agree to|consent|terms (and|&) conditions|privacy (policy|notice)|gdpr|data protection|signature|sign here|e-?sign/i, reason: "Legal declaration / consent" },
  { re: /fund(ing)? (source|declaration|plan)|how will you (fund|finance)|financ|income|bank|salary|scholarship amount|sponsor|tuition payment|fee payment|credit card|card number|cvv|iban/i, reason: "Financial / funding declaration" },
];

const MAPPINGS: { key: string; re: RegExp; autocomplete?: string[] }[] = [
  { key: "firstName", re: /\b(first|given|fore) ?name\b/i, autocomplete: ["given-name"] },
  { key: "lastName", re: /\b(last|family|sur) ?name\b|\bsurname\b/i, autocomplete: ["family-name"] },
  { key: "fullName", re: /\b(full ?name|your name|applicant name|^name)\b/i, autocomplete: ["name"] },
  { key: "email", re: /e-?mail/i, autocomplete: ["email"] },
  { key: "phone", re: /phone|mobile|telephone|\btel\b|contact number/i, autocomplete: ["tel", "tel-national"] },
  { key: "address", re: /\baddress\b|street/i, autocomplete: ["street-address", "address-line1"] },
  { key: "degreeField", re: /field of study|major|discipline|subject area|area of study|specializ|specialis/i },
  { key: "degree", re: /\b(degree|qualification)( title| name| obtained| awarded)?\b/i },
  { key: "institution", re: /(previous|current|awarding|degree)? ?(institution|universit(y|ies)|college|school) ?(name|attended)?/i, autocomplete: ["organization"] },
  { key: "graduationDate", re: /graduation|completion date|date (of )?(award|completion)|year of graduation/i },
  { key: "grade", re: /\b(gpa|cgpa|grade point|final grade|classification|average mark)\b/i },
  { key: "thesisTitle", re: /thesis|dissertation title/i },
  { key: "researchInterests", re: /research (interest|area|topic)s?/i },
  { key: "programmingLanguages", re: /programming languages?/i },
  { key: "skills", re: /\b(skills|technical expertise|competenc)/i },
];

function haystack(f: FieldDescriptor): string {
  return [f.label, f.name, f.id, f.placeholder].filter(Boolean).join(" ").replace(/[_-]+/g, " ");
}

export function classifyField(f: FieldDescriptor): Classification {
  const text = haystack(f);
  const type = (f.type ?? "text").toLowerCase();
  if (type === "password") return { category: "SENSITIVE", reason: "Credentials — enter these yourself" };
  for (const s of SENSITIVE) if (s.re.test(text)) return { category: "SENSITIVE", reason: s.reason };
  // An unlabelled checkbox in an application form is usually a declaration.
  if ((type === "checkbox" || type === "radio") && !text.trim()) return { category: "SENSITIVE", reason: "Unlabelled choice — answer yourself" };
  if (type === "file") return { category: "UPLOAD", reason: "Attach the file yourself (see your application package)" };
  if (["submit", "button", "reset", "image", "hidden"].includes(type)) return { category: "UNMAPPED", reason: "Not a data field" };
  if (type === "checkbox" || type === "radio") return { category: "UNMAPPED", reason: "Choice field — answer yourself" };

  const ac = (f.autocomplete ?? "").toLowerCase();
  for (const m of MAPPINGS) if (m.autocomplete?.some((a) => ac.split(/\s+/).includes(a))) return { category: "MAPPED", key: m.key, reason: `autocomplete="${ac}"` };
  // Name fields: prefer the most specific match (first/last before full).
  for (const m of MAPPINGS) if (m.re.test(text)) return { category: "MAPPED", key: m.key, reason: `Label matches “${m.key}”` };
  return { category: "UNMAPPED", reason: "No matching profile field" };
}

export interface Suggestion {
  index: number;
  label: string;
  category: FieldCategory;
  key?: string;
  value?: string;
  currentValue: string;
  required: boolean;
  reason: string;
  inconsistency?: string;
}

export function suggest(fields: (FieldDescriptor & { currentValue?: string })[], values: FormValues): Suggestion[] {
  return fields.map((f, index) => {
    const c = classifyField(f);
    const value = c.category === "MAPPED" && c.key ? values[c.key] ?? undefined : undefined;
    const current = (f.currentValue ?? "").trim();
    let inconsistency: string | undefined;
    if (value && current && current.toLowerCase() !== value.toLowerCase()) inconsistency = `Field contains “${current}” but your profile says “${value}”.`;
    return {
      index,
      label: f.label || f.name || f.id || f.placeholder || "(unlabelled field)",
      category: c.category,
      key: c.key,
      value: value ?? undefined,
      currentValue: current,
      required: !!f.required,
      reason: c.reason,
      inconsistency,
    };
  });
}
