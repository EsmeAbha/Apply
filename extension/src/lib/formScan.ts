import { suggest, type FormValues, type Suggestion } from "./fields";

export type FillableElement = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

/** Best-effort human label for a form control. */
export function labelFor(el: FillableElement, doc: Document = el.ownerDocument): string {
  const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").replace(/[*:]+\s*$/, "").trim();
  if (el.id) {
    const l = doc.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (l) return clean(l.textContent);
  }
  const wrapping = el.closest("label");
  if (wrapping) return clean(wrapping.textContent);
  const aria = el.getAttribute("aria-label");
  if (aria) return clean(aria);
  const by = el.getAttribute("aria-labelledby");
  if (by) return clean(by.split(/\s+/).map((id) => doc.getElementById(id)?.textContent ?? "").join(" "));
  const prev = el.previousElementSibling;
  if (prev && /^(LABEL|SPAN|B|STRONG|P|DIV)$/.test(prev.tagName) && (prev.textContent ?? "").length < 120) return clean(prev.textContent);
  const cell = el.closest("td")?.previousElementSibling;
  if (cell) return clean(cell.textContent);
  return clean(el.getAttribute("placeholder") ?? el.getAttribute("name") ?? "");
}

export function scanForm(doc: Document): { elements: FillableElement[]; descriptors: Parameters<typeof suggest>[0] } {
  const elements = [...doc.querySelectorAll<FillableElement>("input, textarea, select")].filter((el) => {
    const t = (el.getAttribute("type") ?? "").toLowerCase();
    if (["hidden", "submit", "button", "reset", "image"].includes(t)) return false;
    if (el.disabled) return false;
    return true;
  });
  return {
    elements,
    descriptors: elements.map((el) => ({
      label: labelFor(el, doc),
      name: el.getAttribute("name") ?? undefined,
      id: el.id || undefined,
      type: el instanceof HTMLSelectElement ? "select" : el instanceof HTMLTextAreaElement ? "textarea" : el.getAttribute("type") ?? "text",
      placeholder: el.getAttribute("placeholder") ?? undefined,
      autocomplete: el.getAttribute("autocomplete") ?? undefined,
      required: el.required || el.getAttribute("aria-required") === "true",
      currentValue: el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio") ? "" : el.value,
    })),
  };
}

function setNativeValue(el: FillableElement, value: string): void {
  // Use the prototype setter so frameworks (React/Vue) observe the change.
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

/**
 * Fill ONLY non-sensitive, mapped, currently-empty fields. Never touches sensitive fields, checkboxes,
 * file inputs or submit buttons, and never submits the form. Returns the indexes filled.
 */
export function fillSafeFields(elements: FillableElement[], suggestions: Suggestion[]): number[] {
  const filled: number[] = [];
  for (const s of suggestions) {
    if (s.category !== "MAPPED" || !s.value || s.currentValue) continue;
    const el = elements[s.index];
    if (!el || el instanceof HTMLSelectElement) {
      if (el instanceof HTMLSelectElement) {
        const opt = [...el.options].find((o) => o.text.trim().toLowerCase() === s.value!.toLowerCase() || o.value.toLowerCase() === s.value!.toLowerCase());
        if (opt) {
          setNativeValue(el, opt.value);
          filled.push(s.index);
        }
      }
      continue;
    }
    if (el instanceof HTMLInputElement && ["checkbox", "radio", "file"].includes(el.type)) continue;
    setNativeValue(el, s.value);
    filled.push(s.index);
  }
  return filled;
}

export function analyseDocument(doc: Document, values: FormValues) {
  const { elements, descriptors } = scanForm(doc);
  return { elements, suggestions: suggest(descriptors, values) };
}
