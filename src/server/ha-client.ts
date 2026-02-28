const HA_TIMEOUT_MS = Number(process.env.HA_TIMEOUT_MS || 8000);

const normalizeHaError = (error: unknown, url: string): string => {
  const err = error as any;

  if (err?.name === "AbortError") {
    return `Home Assistant request timed out after ${HA_TIMEOUT_MS}ms (${url})`;
  }

  const causeCode = err?.cause?.code;
  if (causeCode === "ETIMEDOUT") return `Home Assistant connection timed out (${url})`;
  if (causeCode === "ECONNREFUSED") return `Home Assistant connection refused (${url})`;
  if (causeCode === "ENOTFOUND") return `Home Assistant host not found (${url})`;

  if (typeof err?.message === "string" && err.message.length > 0) {
    return `Home Assistant request failed: ${err.message}`;
  }
  return "Home Assistant request failed";
};

export const fetchFromHomeAssistant = async (path: string, init: RequestInit = {}): Promise<Response> => {
  if (!process.env.HA_URL || !process.env.HA_TOKEN) {
    throw new Error("Home Assistant is not configured on the server");
  }

  const url = `${process.env.HA_URL}${path}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HA_TIMEOUT_MS);

  try {
    return await fetch(url, {
      ...init,
      headers: {
        "Authorization": `Bearer ${process.env.HA_TOKEN}`,
        "Content-Type": "application/json",
        ...(init.headers || {}),
      },
      signal: controller.signal,
    });
  } catch (error) {
    throw new Error(normalizeHaError(error, url));
  } finally {
    clearTimeout(timeout);
  }
};
