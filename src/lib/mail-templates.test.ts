import { describe, it, expect } from "vitest";
import { renderEmailHtml, renderButton, newPendingLeaveNotification } from "./mail-templates";

describe("renderEmailHtml", () => {
  it("wraps content in HTML with ePartner HR header and footer", () => {
    const html = renderEmailHtml("<p>Ciao mondo</p>");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("ePartner HR");
    expect(html).toContain("<p>Ciao mondo</p>");
    expect(html).toContain("email automatica");
    expect(html).toContain("hr.epartner.it");
  });

  it("contains logo as base64 data URI", () => {
    const html = renderEmailHtml("<p>test</p>");
    expect(html).toMatch(/src="data:image\/svg\+xml;base64,/);
  });

  it("uses inline styles (no class attributes on wrapper tables)", () => {
    const html = renderEmailHtml("<p>test</p>");
    expect(html).toContain('style="');
    expect(html).not.toMatch(/<table[^>]*class="/);
  });
});

describe("renderButton", () => {
  it("produces an anchor styled as a button", () => {
    const btn = renderButton("Vai", "https://hr.epartner.it/leaves");
    expect(btn).toContain('href="https://hr.epartner.it/leaves"');
    expect(btn).toContain("Vai");
    expect(btn).toContain("background-color");
    expect(btn).toContain("#004253");
  });
});

describe("newPendingLeaveNotification", () => {
  it("produces subject with employee name and type", () => {
    const r = newPendingLeaveNotification({
      employeeName: "Stefano Brunelli",
      leaveTypeLabel: "Ferie",
      startDate: "2026-04-21",
      endDate: "2026-04-25",
    });
    expect(r.subject).toBe("Nuova richiesta: Ferie da Stefano Brunelli");
    expect(r.text).toContain("Stefano Brunelli");
    expect(r.html).toContain("Stefano Brunelli");
    expect(r.html).toContain("Ferie");
    expect(r.html).toContain("Vedi richieste in attesa");
  });
});
