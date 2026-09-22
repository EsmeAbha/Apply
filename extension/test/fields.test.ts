import { describe, expect, it } from "vitest";
import { classifyField, suggest } from "../src/lib/fields";
import { analyseDocument, fillSafeFields, labelFor } from "../src/lib/formScan";

const VALUES = { firstName: "Asha", lastName: "Rahman", fullName: "Asha Rahman", email: "asha@example.com", phone: "+880 1700 000000", institution: "Example University", degree: "MSc", degreeField: "Intelligent Systems", thesisTitle: "Self-supervised speech models", researchInterests: "NLP, LLMs" };

describe("field classification", () => {
  it("never maps sensitive fields", () => {
    for (const label of ["Citizenship", "Nationality", "Date of birth", "Passport number", "Gender", "Do you have a disability?", "Have you ever been convicted of a criminal offence?", "I declare that the information is true", "I agree to the terms and conditions", "How will you fund your studies?", "Visa status", "Password", "Signature"]) {
      expect(classifyField({ label }).category, label).toBe("SENSITIVE");
    }
  });
  it("maps common non-sensitive fields", () => {
    expect(classifyField({ label: "First name" }).key).toBe("firstName");
    expect(classifyField({ label: "Family name" }).key).toBe("lastName");
    expect(classifyField({ label: "Email address" }).key).toBe("email");
    expect(classifyField({ label: "Mobile phone" }).key).toBe("phone");
    expect(classifyField({ label: "Field of study" }).key).toBe("degreeField");
    expect(classifyField({ label: "x", autocomplete: "given-name" }).key).toBe("firstName");
  });
  it("treats uploads and unlabelled checkboxes correctly", () => {
    expect(classifyField({ label: "CV", type: "file" }).category).toBe("UPLOAD");
    expect(classifyField({ label: "", type: "checkbox" }).category).toBe("SENSITIVE");
  });
  it("flags inconsistencies between the form and the profile", () => {
    const [s] = suggest([{ label: "Email", currentValue: "old@example.com" }], VALUES);
    expect(s.inconsistency).toMatch(/old@example.com/);
  });
});

describe("form assistance on a realistic application form", () => {
  const html = `
    <form id="f" action="/submit">
      <label for="fn">First name *</label><input id="fn" name="first_name" required>
      <label for="ln">Last name *</label><input id="ln" name="last_name" required>
      <label>Email <input type="email" name="email"></label>
      <label for="cit">Citizenship</label><select id="cit" name="citizenship"><option value="">--</option><option>Bangladesh</option></select>
      <label for="dob">Date of birth</label><input id="dob" name="dob">
      <input type="text" aria-label="Previous institution" name="inst" value="Other College">
      <label><input type="checkbox" name="decl"> I declare that all information is correct</label>
      <label for="cv">Upload CV</label><input type="file" id="cv" name="cv">
      <label for="stmt">Statement of purpose</label><textarea id="stmt" required></textarea>
      <button type="submit">Submit application</button>
    </form>`;

  it("labels fields, fills only safe empty fields and never submits", () => {
    document.body.innerHTML = html;
    let submitted = false;
    document.getElementById("f")!.addEventListener("submit", (e) => { submitted = true; e.preventDefault(); });
    expect(labelFor(document.getElementById("dob") as HTMLInputElement)).toBe("Date of birth");

    const { elements, suggestions } = analyseDocument(document, VALUES);
    const byLabel = Object.fromEntries(suggestions.map((s) => [s.label, s]));
    expect(byLabel["Citizenship"].category).toBe("SENSITIVE");
    expect(byLabel["I declare that all information is correct"].category).toBe("SENSITIVE");
    expect(byLabel["Upload CV"].category).toBe("UPLOAD");
    expect(byLabel["Previous institution"].inconsistency).toMatch(/Other College/);

    const filled = fillSafeFields(elements, suggestions);
    expect((document.getElementById("fn") as HTMLInputElement).value).toBe("Asha");
    expect((document.getElementById("ln") as HTMLInputElement).value).toBe("Rahman");
    expect((document.querySelector("[name=email]") as HTMLInputElement).value).toBe("asha@example.com");
    // Sensitive, pre-filled and declaration fields untouched:
    expect((document.getElementById("dob") as HTMLInputElement).value).toBe("");
    expect((document.getElementById("cit") as HTMLSelectElement).value).toBe("");
    expect((document.querySelector("[name=decl]") as HTMLInputElement).checked).toBe(false);
    expect((document.querySelector("[name=inst]") as HTMLInputElement).value).toBe("Other College");
    expect(filled).toHaveLength(3);
    expect(submitted).toBe(false);
  });
});
