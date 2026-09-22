import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { uid } from "../auth/middleware.js";
import { prisma } from "../db.js";
import { ah, HttpError } from "../http.js";
import { parseCv } from "../services/cvparse.js";
import { deleteDocument, DOCUMENT_TYPES, listDocuments, readVersion, uploadDocument } from "../services/documents.js";

export const documentsRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 1 } });

documentsRouter.get(
  "/documents",
  ah(async (req, res) => {
    res.json({ items: await listDocuments(uid(req)), types: DOCUMENT_TYPES });
  }),
);

const meta = z.object({
  name: z.string().max(200).optional(),
  type: z.string().optional(),
  labelPrefix: z.string().max(60).optional(),
  language: z.string().max(40).optional(),
  relevantProgram: z.string().max(200).optional(),
  notes: z.string().max(2000).optional(),
  documentDate: z.string().max(40).optional(),
});

documentsRouter.post(
  "/documents",
  upload.single("file"),
  ah(async (req, res) => {
    if (!req.file) throw new HttpError(400, "Attach a file in the `file` field");
    const m = meta.parse(req.body);
    const r = await uploadDocument({ userId: uid(req), ...m, file: req.file });
    res.status(201).json({ document: r.document, version: { ...r.version, storagePath: undefined, extractedText: undefined, hasText: !!r.version.extractedText } });
  }),
);

/** New version of an existing document — earlier versions are kept untouched. */
documentsRouter.post(
  "/documents/:id/versions",
  upload.single("file"),
  ah(async (req, res) => {
    if (!req.file) throw new HttpError(400, "Attach a file in the `file` field");
    const m = meta.parse(req.body);
    const r = await uploadDocument({ userId: uid(req), documentId: String(req.params.id), ...m, file: req.file });
    res.status(201).json({ document: r.document, version: { ...r.version, storagePath: undefined, extractedText: undefined, hasText: !!r.version.extractedText } });
  }),
);

documentsRouter.patch(
  "/documents/:id",
  ah(async (req, res) => {
    const body = z.object({ name: z.string().max(200).optional(), status: z.enum(["DRAFT", "READY", "NEEDS_UPDATE", "ARCHIVED"]).optional(), language: z.string().max(40).optional(), relevantProgram: z.string().max(200).optional(), notes: z.string().max(2000).optional(), documentDate: z.string().max(40).optional() }).parse(req.body);
    const r = await prisma.document.updateMany({ where: { id: String(req.params.id), userId: uid(req) }, data: body });
    if (!r.count) throw new HttpError(404, "Document not found");
    res.json({ ok: true });
  }),
);

documentsRouter.delete(
  "/documents/:id",
  ah(async (req, res) => {
    await deleteDocument(uid(req), String(req.params.id));
    res.json({ ok: true });
  }),
);

documentsRouter.get(
  "/documents/versions/:vid/download",
  ah(async (req, res) => {
    const { version, data } = await readVersion(uid(req), String(req.params.vid));
    res.setHeader("Content-Type", version.mimeType);
    res.setHeader("Content-Disposition", `attachment; filename="${version.label}_${version.originalName.replace(/[^\w.-]+/g, "_")}"`);
    res.setHeader("Cache-Control", "no-store");
    res.send(data);
  }),
);

documentsRouter.get(
  "/documents/versions/:vid/text",
  ah(async (req, res) => {
    const v = await prisma.documentVersion.findUnique({ where: { id: String(req.params.vid) }, include: { document: true } });
    if (!v || v.document.userId !== uid(req)) throw new HttpError(404, "Document version not found");
    res.json({ text: v.extractedText });
  }),
);

/** POST /analyze-document — propose profile entries from a CV version. Nothing is saved until the user imports. */
documentsRouter.post(
  "/analyze-document",
  ah(async (req, res) => {
    const { versionId, text } = z.object({ versionId: z.string().optional(), text: z.string().max(200_000).optional() }).parse(req.body);
    let content = text;
    if (versionId) {
      const v = await prisma.documentVersion.findUnique({ where: { id: versionId }, include: { document: true } });
      if (!v || v.document.userId !== uid(req)) throw new HttpError(404, "Document version not found");
      if (!v.extractedText) throw new HttpError(422, "No text could be extracted from this file (it may be a scanned image). OCR is not included in this version — upload a text-based PDF/DOCX or paste the text.");
      content = v.extractedText;
    }
    if (!content) throw new HttpError(400, "Provide versionId or text");
    res.json({ ...parseCv(content), note: "These are proposals extracted from your CV. Review each item and import only what is correct." });
  }),
);
