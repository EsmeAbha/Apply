import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { HttpError } from "../http.js";
import { decrypt, encrypt, sha256Hex } from "../security/crypto.js";

export const DOCUMENT_TYPES = [
  "CV", "PASSPORT", "TRANSCRIPT", "CERTIFICATE", "DEGREE", "PUBLICATION", "THESIS", "SOP", "COVER_LETTER",
  "RESEARCH_PROPOSAL", "RECOMMENDATION", "ENGLISH_TEST", "ENGLISH_MEDIUM_CERT", "OTHER",
] as const;

const SENSITIVE_TYPES = new Set(["PASSPORT", "TRANSCRIPT", "DEGREE", "CERTIFICATE", "ENGLISH_TEST"]);
const ALLOWED_MIME = /^(application\/pdf|application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document|application\/msword|text\/plain|text\/markdown|image\/(png|jpeg|webp))$/;

export async function extractDocumentText(buf: Buffer, mimeType: string, name: string): Promise<string | null> {
  try {
    if (mimeType === "application/pdf" || name.toLowerCase().endsWith(".pdf")) {
      const pdf = await getDocumentProxy(new Uint8Array(buf));
      const { text } = await extractText(pdf, { mergePages: true });
      const t = (Array.isArray(text) ? text.join("\n") : text).trim();
      return t || null; // scanned PDFs have no text layer
    }
    if (mimeType.includes("wordprocessingml") || name.toLowerCase().endsWith(".docx")) {
      const r = await mammoth.extractRawText({ buffer: buf });
      return r.value.trim() || null;
    }
    if (mimeType.startsWith("text/")) return buf.toString("utf8");
  } catch {
    return null;
  }
  return null;
}

function labelPrefix(type: string, custom?: string): string {
  const base = (custom ?? type).replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "");
  return base || "DOC";
}

export interface UploadInput {
  userId: string;
  documentId?: string; // add a new version to an existing document
  name?: string;
  type?: string;
  labelPrefix?: string;
  language?: string;
  relevantProgram?: string;
  notes?: string;
  documentDate?: string;
  file: { buffer: Buffer; originalname: string; mimetype: string; size: number };
}

/** Store an uploaded file encrypted at rest. Existing versions are never modified or overwritten. */
export async function uploadDocument(input: UploadInput) {
  const { file } = input;
  if (!ALLOWED_MIME.test(file.mimetype)) throw new HttpError(415, `Unsupported file type ${file.mimetype}. Use PDF, DOCX, TXT or images.`);

  let doc = input.documentId ? await prisma.document.findFirst({ where: { id: input.documentId, userId: input.userId } }) : null;
  if (input.documentId && !doc) throw new HttpError(404, "Document not found");
  if (!doc) {
    const type = (input.type ?? "OTHER").toUpperCase();
    if (!DOCUMENT_TYPES.includes(type as (typeof DOCUMENT_TYPES)[number])) throw new HttpError(400, `Unknown document type ${type}`);
    doc = await prisma.document.create({
      data: {
        userId: input.userId,
        name: input.name ?? file.originalname,
        type,
        language: input.language,
        relevantProgram: input.relevantProgram,
        notes: input.notes,
        documentDate: input.documentDate,
        sensitive: SENSITIVE_TYPES.has(type),
      },
    });
  }
  const last = await prisma.documentVersion.findFirst({ where: { documentId: doc.id }, orderBy: { versionNumber: "desc" } });
  const versionNumber = (last?.versionNumber ?? 0) + 1;
  const dir = path.join(config.storageDir, input.userId);
  await mkdir(dir, { recursive: true });
  const storagePath = path.join(dir, `${randomUUID()}.enc`);
  await writeFile(storagePath, encrypt(file.buffer), { mode: 0o600 });
  const extractedText = doc.type === "PASSPORT" ? null : await extractDocumentText(file.buffer, file.mimetype, file.originalname);

  const version = await prisma.documentVersion.create({
    data: {
      documentId: doc.id,
      versionNumber,
      label: `${labelPrefix(doc.type, input.labelPrefix)}_v${versionNumber}`,
      originalName: file.originalname,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      sha256: sha256Hex(file.buffer),
      storagePath,
      extractedText,
      notes: input.notes,
    },
  });
  await prisma.document.update({ where: { id: doc.id }, data: { updatedAt: new Date() } });
  return { document: doc, version };
}

/** Create a text version (e.g. an approved generated SOP) as a new document version. */
export async function saveTextVersion(userId: string, opts: { documentId?: string; name: string; type: string; labelPrefix: string; text: string; notes?: string; relevantProgram?: string }) {
  return uploadDocument({
    userId,
    documentId: opts.documentId,
    name: opts.name,
    type: opts.type,
    labelPrefix: opts.labelPrefix,
    notes: opts.notes,
    relevantProgram: opts.relevantProgram,
    file: { buffer: Buffer.from(opts.text, "utf8"), originalname: `${opts.labelPrefix}.txt`, mimetype: "text/plain", size: Buffer.byteLength(opts.text) },
  });
}

export async function readVersion(userId: string, versionId: string) {
  const v = await prisma.documentVersion.findUnique({ where: { id: versionId }, include: { document: true } });
  if (!v || v.document.userId !== userId) throw new HttpError(404, "Document version not found");
  const blob = await readFile(v.storagePath);
  return { version: v, data: decrypt(blob) };
}

export async function deleteDocument(userId: string, documentId: string) {
  const doc = await prisma.document.findFirst({ where: { id: documentId, userId }, include: { versions: true } });
  if (!doc) throw new HttpError(404, "Document not found");
  for (const v of doc.versions) await rm(v.storagePath, { force: true });
  await prisma.document.delete({ where: { id: documentId } });
}

export async function listDocuments(userId: string) {
  const docs = await prisma.document.findMany({
    where: { userId },
    orderBy: [{ type: "asc" }, { updatedAt: "desc" }],
    include: { versions: { orderBy: { versionNumber: "desc" }, select: { id: true, versionNumber: true, label: true, originalName: true, mimeType: true, sizeBytes: true, createdAt: true, notes: true, sha256: true } } },
  });
  return docs;
}
