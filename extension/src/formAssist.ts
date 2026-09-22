/**
 * Injected ON DEMAND (never on every page) when the user clicks “Assist with this form”.
 * Shows a panel, highlights fields and fills only non-sensitive fields when the user clicks.
 * It never answers sensitive questions, never ticks declarations and never submits.
 */
import type { FormValues } from "./lib/fields";
import { analyseDocument, fillSafeFields } from "./lib/formScan";

declare global {
  interface Window {
    __phdAssistInstalled?: boolean;
    __phdAssistListener?: boolean;
  }
}

const COLORS = { SENSITIVE: "#dc2626", MAPPED: "#16a34a", UPLOAD: "#2563eb", UNMAPPED: "#94a3b8", REQUIRED: "#d97706" };

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function render(values: FormValues): void {
  document.getElementById("phd-assist-host")?.remove();
  const { elements, suggestions } = analyseDocument(document, values);

  suggestions.forEach((s) => {
    const el = elements[s.index] as HTMLElement;
    const color = s.category === "SENSITIVE" ? COLORS.SENSITIVE : s.category === "MAPPED" && s.value ? COLORS.MAPPED : s.required && !s.currentValue ? COLORS.REQUIRED : s.category === "UPLOAD" ? COLORS.UPLOAD : "";
    if (color) {
      el.style.outline = `2px solid ${color}`;
      el.style.outlineOffset = "2px";
    }
    if (s.category === "SENSITIVE") el.title = `PhD Assistant: answer this yourself — ${s.reason}`;
  });

  const host = document.createElement("div");
  host.id = "phd-assist-host";
  host.style.cssText = "position:fixed;top:12px;right:12px;z-index:2147483647;";
  const root = host.attachShadow({ mode: "open" });
  const sensitive = suggestions.filter((s) => s.category === "SENSITIVE");
  const fillable = suggestions.filter((s) => s.category === "MAPPED" && s.value && !s.currentValue);
  const missingRequired = suggestions.filter((s) => s.required && !s.currentValue && s.category !== "MAPPED");
  const inconsistent = suggestions.filter((s) => s.inconsistency);
  const row = (s: (typeof suggestions)[number]) =>
    `<li><b>${esc(s.label.slice(0, 60))}</b>${s.value ? ` → <span class="v">${esc(s.value.slice(0, 60))}</span>` : ""}<br><small>${esc(s.inconsistency ?? s.reason)}</small></li>`;

  root.innerHTML = `
  <style>
    .p{width:360px;max-height:80vh;overflow:auto;background:#fff;border:1px solid #cbd5e1;border-radius:12px;box-shadow:0 10px 30px rgba(15,23,42,.2);font:13px/1.4 system-ui,sans-serif;color:#0f172a}
    header{display:flex;justify-content:space-between;align-items:center;padding:10px 12px;background:#1e3a8a;color:#fff;border-radius:12px 12px 0 0}
    section{padding:8px 12px;border-top:1px solid #e2e8f0} h4{margin:0 0 4px;font-size:12px;text-transform:uppercase;letter-spacing:.04em}
    ul{margin:0;padding-left:16px} li{margin:3px 0} small{color:#475569} .v{color:#15803d}
    button{font:inherit;border-radius:8px;padding:6px 10px;border:1px solid #cbd5e1;background:#fff;cursor:pointer} .primary{background:#1e3a8a;color:#fff;border-color:#1e3a8a}
    .x{background:transparent;border:0;color:#fff;font-size:16px}
    .note{font-size:12px;color:#475569}
  </style>
  <div class="p">
    <header><b>PhD Assistant — form review</b><button class="x" id="close" aria-label="Close">×</button></header>
    <section class="note">Green = suggestion from your profile · Red = answer yourself · Amber = required & empty · Blue = upload yourself. Nothing is submitted by this assistant.</section>
    <section><h4 style="color:${COLORS.MAPPED}">Suggested (${fillable.length})</h4>${fillable.length ? `<ul>${fillable.map(row).join("")}</ul><p><button class="primary" id="fill">Fill ${fillable.length} non-sensitive field(s)</button></p>` : '<p class="note">No empty fields match your profile.</p>'}</section>
    <section><h4 style="color:${COLORS.SENSITIVE}">Answer yourself (${sensitive.length})</h4>${sensitive.length ? `<ul>${sensitive.map(row).join("")}</ul>` : '<p class="note">None detected.</p>'}</section>
    ${missingRequired.length ? `<section><h4 style="color:${COLORS.REQUIRED}">Required and still empty (${missingRequired.length})</h4><ul>${missingRequired.map(row).join("")}</ul></section>` : ""}
    ${inconsistent.length ? `<section><h4 style="color:${COLORS.REQUIRED}">Inconsistencies (${inconsistent.length})</h4><ul>${inconsistent.map(row).join("")}</ul></section>` : ""}
    <section class="note">Before you submit: review every declaration yourself, then use the dashboard's Final Review page to record your submission.</section>
  </div>`;
  document.documentElement.appendChild(host);
  root.getElementById("close")?.addEventListener("click", () => host.remove());
  root.getElementById("fill")?.addEventListener("click", () => {
    const filled = fillSafeFields(elements, suggestions);
    (root.getElementById("fill") as HTMLButtonElement).textContent = `Filled ${filled.length} field(s) — please review them`;
    (root.getElementById("fill") as HTMLButtonElement).disabled = true;
  });

  installSubmitGuard();
}

/** A reminder when the user presses the portal's own submit button. It never blocks a confirmed submission. */
function installSubmitGuard(): void {
  if (window.__phdAssistInstalled) return;
  window.__phdAssistInstalled = true;
  document.addEventListener(
    "submit",
    (e) => {
      const ok = window.confirm("PhD Assistant: you are about to submit this form on the official portal.\n\nHave you reviewed every field and declaration yourself?\n\nPress OK to submit, or Cancel to keep reviewing.");
      if (!ok) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    },
    true,
  );
}

// The script may be injected more than once on the same page; register the listener once.
if (!window.__phdAssistListener) {
  window.__phdAssistListener = true;
  chrome.runtime.onMessage.addListener((msg: { type?: string; values?: FormValues }, _sender, sendResponse) => {
    if (msg?.type === "PHD_FORM_ASSIST") {
      render(msg.values ?? {});
      sendResponse({ ok: true });
    }
  });
}
