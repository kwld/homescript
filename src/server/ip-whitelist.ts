import { isIP } from "net";

const normalizeIp = (raw: string) => {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("::ffff:")) return trimmed.slice(7);
  return trimmed;
};

const parseIpv4ToBigInt = (value: string) => {
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  let out = 0n;
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null;
    const num = Number(part);
    if (num < 0 || num > 255) return null;
    out = (out << 8n) + BigInt(num);
  }
  return out;
};

const parseIpv6ToBigInt = (value: string) => {
  const v = value.toLowerCase();
  if (v.includes(":::")) return null;
  const halves = v.split("::");
  if (halves.length > 2) return null;

  const left = halves[0] ? halves[0].split(":").filter(Boolean) : [];
  const right = halves[1] ? halves[1].split(":").filter(Boolean) : [];
  if (left.some((h) => !/^[0-9a-f]{1,4}$/.test(h))) return null;
  if (right.some((h) => !/^[0-9a-f]{1,4}$/.test(h))) return null;
  if (left.length + right.length > 8) return null;

  const missing = 8 - (left.length + right.length);
  const full = [...left, ...Array(missing).fill("0"), ...right];
  if (full.length !== 8) return null;

  let out = 0n;
  for (const hextet of full) {
    out = (out << 16n) + BigInt(parseInt(hextet, 16));
  }
  return out;
};

const parseIpBits = (raw: string): { version: 4 | 6; bits: bigint; size: number } | null => {
  const ip = normalizeIp(raw);
  const ver = isIP(ip);
  if (ver === 4) {
    const bits = parseIpv4ToBigInt(ip);
    if (bits === null) return null;
    return { version: 4, bits, size: 32 };
  }
  if (ver === 6) {
    const bits = parseIpv6ToBigInt(ip);
    if (bits === null) return null;
    return { version: 6, bits, size: 128 };
  }
  return null;
};

export const isValidIpOrCidr = (raw: string) => {
  const value = normalizeIp(raw);
  if (!value) return false;
  if (!value.includes("/")) return parseIpBits(value) !== null;
  const [ip, prefixRaw] = value.split("/");
  if (!ip || prefixRaw === undefined) return false;
  if (!/^\d+$/.test(prefixRaw)) return false;
  const parsed = parseIpBits(ip);
  if (!parsed) return false;
  const prefix = Number(prefixRaw);
  return prefix >= 0 && prefix <= parsed.size;
};

export const isIpAllowedByWhitelist = (clientIpRaw: string, whitelist: string[]) => {
  const clientParsed = parseIpBits(clientIpRaw);
  if (!clientParsed) return false;
  for (const rawEntry of whitelist) {
    const entry = normalizeIp(rawEntry);
    if (!entry) continue;
    if (!entry.includes("/")) {
      const parsed = parseIpBits(entry);
      if (!parsed || parsed.version !== clientParsed.version) continue;
      if (parsed.bits === clientParsed.bits) return true;
      continue;
    }
    const [baseIp, prefixRaw] = entry.split("/");
    if (!baseIp || prefixRaw === undefined) continue;
    const parsedBase = parseIpBits(baseIp);
    if (!parsedBase || parsedBase.version !== clientParsed.version) continue;
    const prefix = Number(prefixRaw);
    if (Number.isNaN(prefix) || prefix < 0 || prefix > parsedBase.size) continue;
    const shift = BigInt(parsedBase.size - prefix);
    const clientNet = shift === 0n ? clientParsed.bits : (clientParsed.bits >> shift) << shift;
    const baseNet = shift === 0n ? parsedBase.bits : (parsedBase.bits >> shift) << shift;
    if (clientNet === baseNet) return true;
  }
  return false;
};

export const normalizeRequestIp = (raw: string) => normalizeIp(raw);

