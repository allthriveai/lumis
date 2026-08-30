import { describe, it, expect } from "vitest";
import { parseDateKey, toDateKey, shiftDateKey, daysBetween, formatDate, normalizeDateKey } from "./dates.js";

describe("date keys are local calendar days", () => {
  it("parses a key to local midnight, not UTC midnight", () => {
    // `new Date("2026-08-19")` is UTC midnight, which is Aug 18 west of UTC.
    const d = parseDateKey("2026-08-19");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(7);
    expect(d.getDate()).toBe(19);
  });

  it("round-trips through toDateKey", () => {
    expect(toDateKey(parseDateKey("2026-01-01"))).toBe("2026-01-01");
    expect(toDateKey(parseDateKey("2026-12-31"))).toBe("2026-12-31");
  });

  it("rejects a malformed key rather than producing an Invalid Date", () => {
    expect(() => parseDateKey("Aug 19")).toThrow();
    expect(() => parseDateKey("2026-8-19")).toThrow();
  });

  it("shifts across month and year boundaries", () => {
    expect(shiftDateKey("2026-08-31", 1)).toBe("2026-09-01");
    expect(shiftDateKey("2026-01-01", -1)).toBe("2025-12-31");
    expect(shiftDateKey("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("counts whole days across a DST boundary", () => {
    // US DST ends 2026-11-01; that day is 25 hours long. Rounding, not flooring,
    // is what keeps this from coming out as 0.
    expect(daysBetween("2026-10-31", "2026-11-02")).toBe(2);
    expect(daysBetween("2026-11-02", "2026-10-31")).toBe(-2);
    expect(daysBetween("2026-08-19", "2026-08-19")).toBe(0);
  });

  it("formats Obsidian moment tokens", () => {
    expect(formatDate(parseDateKey("2026-08-29"), "dddd, MMMM D, YYYY")).toBe("Saturday, August 29, 2026");
  });
});

describe("normalizeDateKey", () => {
  it("reads a YAML-parsed Date with UTC getters", () => {
    // YAML turns an unquoted `date: 2026-02-23` into a Date at UTC midnight.
    // Local getters would report the 22nd anywhere west of UTC.
    expect(normalizeDateKey(new Date("2026-02-23T00:00:00Z"))).toBe("2026-02-23");
  });

  it("reads a quoted string", () => {
    expect(normalizeDateKey("2026-02-23")).toBe("2026-02-23");
    expect(normalizeDateKey("2026-02-23 Saturday")).toBe("2026-02-23");
  });

  it("returns null rather than guessing", () => {
    expect(normalizeDateKey(undefined)).toBeNull();
    expect(normalizeDateKey("")).toBeNull();
    expect(normalizeDateKey("someday")).toBeNull();
    expect(normalizeDateKey(new Date("nope"))).toBeNull();
  });
});
