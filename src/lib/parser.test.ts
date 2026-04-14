import { describe, it, expect } from "vitest";
import { parseWhatsAppExport } from "./parser";

function msg(date: string, time: string, name: string, text: string): string {
  return `[${date}, ${time}] ${name}: ${text}`;
}

describe("parseWhatsAppExport", () => {
  describe("basic entry/exit", () => {
    it("parses 'Entrata' with declared time", () => {
      const input = msg("14/04/25", "09:05:30", "Mario Rossi", "Entrata ore 09:00");
      const { records, errors } = parseWhatsAppExport(input);
      expect(errors).toHaveLength(0);
      expect(records).toHaveLength(1);
      expect(records[0].type).toBe("ENTRY");
      expect(records[0].declaredTime).toBe("09:00");
      expect(records[0].messageTime).toBe("09:05");
      expect(records[0].employeeName).toBe("Mario Rossi");
      expect(records[0].date).toBe("2025-04-14");
    });

    it("parses 'Uscita' without time (uses message time)", () => {
      const input = msg("14/04/25", "18:30:00", "Mario Rossi", "Uscita");
      const { records } = parseWhatsAppExport(input);
      expect(records).toHaveLength(1);
      expect(records[0].type).toBe("EXIT");
      expect(records[0].declaredTime).toBe("18:30");
    });

    it("parses dot as ENTRY", () => {
      const input = msg("14/04/25", "09:00:00", "Mario Rossi", ".");
      const { records } = parseWhatsAppExport(input);
      expect(records).toHaveLength(1);
      expect(records[0].type).toBe("ENTRY");
    });

    it("handles time with dot separator (9.06 → 09:06)", () => {
      const input = msg("14/04/25", "09:10:00", "Mario Rossi", "Entrata 9.06");
      const { records } = parseWhatsAppExport(input);
      expect(records[0].declaredTime).toBe("09:06");
    });

    it("handles time-first format (HH:MM entrata)", () => {
      const input = msg("14/04/25", "09:10:00", "Mario Rossi", "09:00 entrata");
      const { records } = parseWhatsAppExport(input);
      expect(records[0].type).toBe("ENTRY");
      expect(records[0].declaredTime).toBe("09:00");
    });

    it("handles common typos", () => {
      const input = msg("14/04/25", "09:10:00", "Mario Rossi", "Entrara 09:00");
      const { records } = parseWhatsAppExport(input);
      expect(records[0].type).toBe("ENTRY");
    });
  });

  describe("pauses", () => {
    it("parses 'Pausa' as PAUSE_START", () => {
      const input = msg("14/04/25", "10:30:00", "Mario Rossi", "Pausa");
      const { records } = parseWhatsAppExport(input);
      expect(records).toHaveLength(1);
      expect(records[0].type).toBe("PAUSE_START");
    });

    it("parses 'Fine pausa' as PAUSE_END", () => {
      const input = msg("14/04/25", "10:45:00", "Mario Rossi", "Fine pausa");
      const { records } = parseWhatsAppExport(input);
      expect(records[0].type).toBe("PAUSE_END");
    });

    it("parses 'Pausa HH:MM - HH:MM' as PAUSE_START + PAUSE_END", () => {
      const input = msg("14/04/25", "13:00:00", "Mario Rossi", "Pausa 13:00 - 14:00");
      const { records } = parseWhatsAppExport(input);
      expect(records).toHaveLength(2);
      expect(records[0].type).toBe("PAUSE_START");
      expect(records[0].declaredTime).toBe("13:00");
      expect(records[1].type).toBe("PAUSE_END");
      expect(records[1].declaredTime).toBe("14:00");
    });

    it("resolves 'Pausa come [name]'", () => {
      const lines = [
        msg("14/04/25", "13:00:00", "Mario Rossi", "Pausa 13:00 - 14:00"),
        msg("14/04/25", "13:05:00", "Luigi Verdi", "Pausa come mario"),
      ].join("\n");
      const { records } = parseWhatsAppExport(lines);
      const luigi = records.filter((r) => r.employeeName === "Luigi Verdi");
      expect(luigi).toHaveLength(2);
      expect(luigi[0].type).toBe("PAUSE_START");
      expect(luigi[0].declaredTime).toBe("13:00");
      expect(luigi[1].type).toBe("PAUSE_END");
      expect(luigi[1].declaredTime).toBe("14:00");
    });
  });

  describe("overtime", () => {
    it("parses 'Inizio straordinario'", () => {
      const input = msg("14/04/25", "18:30:00", "Mario Rossi", "Inizio straordinario");
      const { records } = parseWhatsAppExport(input);
      expect(records[0].type).toBe("OVERTIME_START");
    });

    it("parses 'Fine straordinario'", () => {
      const input = msg("14/04/25", "20:00:00", "Mario Rossi", "Fine straordinario");
      const { records } = parseWhatsAppExport(input);
      expect(records[0].type).toBe("OVERTIME_END");
    });

    it("parses '+N minuti HH:MM-HH:MM' as overtime block", () => {
      const input = msg("14/04/25", "20:00:00", "Mario Rossi", "+30 minuti 18:30-19:00");
      const { records } = parseWhatsAppExport(input);
      expect(records).toHaveLength(2);
      expect(records[0].type).toBe("OVERTIME_START");
      expect(records[0].declaredTime).toBe("18:30");
      expect(records[1].type).toBe("OVERTIME_END");
      expect(records[1].declaredTime).toBe("19:00");
    });
  });

  describe("'fine' context resolution", () => {
    it("resolves 'fine' after PAUSE_START as PAUSE_END", () => {
      const lines = [
        msg("14/04/25", "10:30:00", "Mario Rossi", "Pausa"),
        msg("14/04/25", "10:45:00", "Mario Rossi", "Fine"),
      ].join("\n");
      const { records, errors } = parseWhatsAppExport(lines);
      expect(errors).toHaveLength(0);
      const types = records.map((r) => r.type);
      expect(types).toEqual(["PAUSE_START", "PAUSE_END"]);
    });

    it("resolves 'fine' after OVERTIME_START as OVERTIME_END", () => {
      const lines = [
        msg("14/04/25", "18:30:00", "Mario Rossi", "Inizio straordinario"),
        msg("14/04/25", "20:00:00", "Mario Rossi", "Fine"),
      ].join("\n");
      const { records } = parseWhatsAppExport(lines);
      const types = records.map((r) => r.type);
      expect(types).toEqual(["OVERTIME_START", "OVERTIME_END"]);
    });

    it("reports error for 'fine' without open state", () => {
      const input = msg("14/04/25", "10:00:00", "Mario Rossi", "Fine");
      const { errors } = parseWhatsAppExport(input);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain("fine");
    });
  });

  describe("excluded names", () => {
    it("filters out excluded employees", () => {
      const input = msg("14/04/25", "09:00:00", "Mario Rossi", "Entrata");
      const { records } = parseWhatsAppExport(input, ["Mario Rossi"]);
      expect(records).toHaveLength(0);
    });

    it("exclusion is case-insensitive", () => {
      const input = msg("14/04/25", "09:00:00", "Mario Rossi", "Entrata");
      const { records } = parseWhatsAppExport(input, ["mario rossi"]);
      expect(records).toHaveLength(0);
    });
  });

  describe("date parsing", () => {
    it("handles DD/MM/YY format", () => {
      const input = msg("01/03/25", "09:00:00", "Mario Rossi", "Entrata");
      const { records } = parseWhatsAppExport(input);
      expect(records[0].date).toBe("2025-03-01");
    });

    it("handles DD/MM/YYYY format", () => {
      const input = msg("01/03/2025", "09:00:00", "Mario Rossi", "Entrata");
      const { records } = parseWhatsAppExport(input);
      expect(records[0].date).toBe("2025-03-01");
    });
  });

  describe("skippable messages", () => {
    it("skips greetings", () => {
      const input = msg("14/04/25", "09:00:00", "Mario Rossi", "Buongiorno a tutti");
      const { records } = parseWhatsAppExport(input);
      expect(records).toHaveLength(0);
    });

    it("skips standalone time ranges (handled at full-content level)", () => {
      const input = msg("14/04/25", "09:00:00", "Mario Rossi", "09:00-13:00");
      const { records } = parseWhatsAppExport(input);
      expect(records).toHaveLength(0);
    });
  });

  describe("qualifiers", () => {
    it("handles 'Entrata pomeriggio'", () => {
      const input = msg("14/04/25", "14:30:00", "Mario Rossi", "Entrata pomeriggio 14:30");
      const { records } = parseWhatsAppExport(input);
      expect(records[0].type).toBe("ENTRY");
      expect(records[0].declaredTime).toBe("14:30");
    });

    it("handles 'Uscita pranzo'", () => {
      const input = msg("14/04/25", "13:00:00", "Mario Rossi", "Uscita pranzo");
      const { records } = parseWhatsAppExport(input);
      expect(records[0].type).toBe("EXIT");
    });
  });
});
