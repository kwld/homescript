export type ParsedHistoryResponse = {
  points: Array<{ ts: string; value: number; state?: string }>;
};

const mapRawSeriesToPoints = (series: any[]): ParsedHistoryResponse["points"] => {
  return series
    .map((item: any) => {
      const stateRaw = item?.state;
      const ts = item?.last_changed || item?.last_updated;
      if (!ts || stateRaw === undefined || stateRaw === null) return null;

      let numericValue: number | null = Number(stateRaw);
      if (!Number.isFinite(numericValue)) {
        if (stateRaw === "on") numericValue = 1;
        else if (stateRaw === "off") numericValue = 0;
        else numericValue = null;
      }
      if (numericValue === null) return null;

      return {
        ts,
        value: Number(numericValue),
        state: String(stateRaw),
      };
    })
    .filter(Boolean) as ParsedHistoryResponse["points"];
};

export const parseHistoryApiResponse = (
  status: number,
  contentType: string | null,
  bodyText: string,
): ParsedHistoryResponse => {
  const trimmed = (bodyText || "").trim();

  if (status >= 200 && status < 300 && trimmed.length === 0) {
    return { points: [] };
  }

  let data: any = null;

  if (trimmed) {
    try {
      data = JSON.parse(trimmed);
    } catch {
      data = null;
    }
  }

  if (status < 200 || status >= 300) {
    const message =
      data?.error ||
      (contentType?.includes("text/html")
        ? "History API returned HTML. Backend route may be unavailable; restart server."
        : `HTTP ${status}`);
    throw new Error(message);
  }

  if (!data || typeof data !== "object") {
    if (contentType?.includes("text/html")) {
      throw new Error("History API returned HTML. Backend route may be unavailable; restart server.");
    }
    throw new Error("History API returned invalid response format");
  }

  // Preferred backend shape.
  if (Array.isArray(data.points)) {
    return { points: data.points };
  }

  // Tolerate raw HA history shape: [ [ {state,last_changed,...}, ... ] ].
  if (Array.isArray(data) && Array.isArray(data[0])) {
    return { points: mapRawSeriesToPoints(data[0]) };
  }

  return {
    points: [],
  };
};
