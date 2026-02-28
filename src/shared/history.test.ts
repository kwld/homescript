import { describe, expect, it } from "vitest";
import { parseHistoryApiResponse } from "./history.js";

describe("parseHistoryApiResponse", () => {
  it("parses valid JSON payload with points", () => {
    const payload = JSON.stringify({
      points: [{ ts: "2026-02-28T10:00:00Z", value: 21.4, state: "21.4" }],
    });
    const result = parseHistoryApiResponse(200, "application/json", payload);
    expect(result.points).toHaveLength(1);
    expect(result.points[0].value).toBe(21.4);
  });

  it("throws invalid format error for non-JSON success body", () => {
    expect(() =>
      parseHistoryApiResponse(200, "text/plain", "not json at all"),
    ).toThrow("History API returned invalid response format");
  });

  it("parses empty successful response as empty points", () => {
    const result = parseHistoryApiResponse(200, "application/json", "");
    expect(result.points).toEqual([]);
  });

  it("parses raw Home Assistant history payload shape", () => {
    const raw = JSON.stringify([
      [
        {
          entity_id: "sensor.test",
          state: "42",
          last_changed: "2026-02-28T10:00:00Z",
          last_updated: "2026-02-28T10:00:00Z",
        },
        {
          entity_id: "sensor.test",
          state: "on",
          last_changed: "2026-02-28T10:05:00Z",
        },
      ],
    ]);
    const result = parseHistoryApiResponse(200, "application/json", raw);
    expect(result.points).toHaveLength(2);
    expect(result.points[0].value).toBe(42);
    expect(result.points[1].value).toBe(1);
  });

  it("throws HTML fallback error for non-2xx HTML response", () => {
    expect(() =>
      parseHistoryApiResponse(404, "text/html", "<!doctype html><html></html>"),
    ).toThrow("History API returned HTML. Backend route may be unavailable; restart server.");
  });
});
