const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === "object") {
    Object.freeze(value);
    Object.getOwnPropertyNames(value).forEach((key) => {
      const nested = (value as any)[key];
      if (nested && typeof nested === "object" && !Object.isFrozen(nested)) {
        deepFreeze(nested);
      }
    });
  }
  return value;
};

const toNumber = (value: any, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toStringValue = (value: any) => String(value ?? "");

const normalizeArray = <T = any>(value: any): T[] => (Array.isArray(value) ? value : []);

const stringReplaceAll = (input: any, search: any, replacement: any) => {
  const source = toStringValue(input);
  const target = toStringValue(search);
  if (!target) return source;
  return source.split(target).join(toStringValue(replacement));
};

export const HOME_SCRIPT_COMMON = deepFreeze({
  math: {
    abs: (value: any) => Math.abs(toNumber(value)),
    min: (...values: any[]) => Math.min(...values.map((value) => toNumber(value))),
    max: (...values: any[]) => Math.max(...values.map((value) => toNumber(value))),
    clamp: (value: any, minValue: any, maxValue: any) =>
      Math.min(Math.max(toNumber(value), toNumber(minValue)), toNumber(maxValue)),
    round: (value: any, decimals = 0) => {
      const d = Math.max(0, Math.floor(toNumber(decimals)));
      const factor = 10 ** d;
      return Math.round(toNumber(value) * factor) / factor;
    },
    floor: (value: any) => Math.floor(toNumber(value)),
    ceil: (value: any) => Math.ceil(toNumber(value)),
    sum: (items: any) => normalizeArray(items).reduce((acc, item) => acc + toNumber(item), 0),
    avg: (items: any) => {
      const arr = normalizeArray(items).map((item) => toNumber(item));
      if (arr.length === 0) return 0;
      return arr.reduce((acc, item) => acc + item, 0) / arr.length;
    },
    between: (value: any, minValue: any, maxValue: any) => {
      const n = toNumber(value);
      return n >= toNumber(minValue) && n <= toNumber(maxValue);
    },
  },
  string: {
    lower: (value: any) => toStringValue(value).toLowerCase(),
    upper: (value: any) => toStringValue(value).toUpperCase(),
    trim: (value: any) => toStringValue(value).trim(),
    contains: (value: any, part: any) => toStringValue(value).includes(toStringValue(part)),
    startsWith: (value: any, part: any) => toStringValue(value).startsWith(toStringValue(part)),
    endsWith: (value: any, part: any) => toStringValue(value).endsWith(toStringValue(part)),
    replaceAll: (value: any, search: any, replacement: any) => stringReplaceAll(value, search, replacement),
    split: (value: any, separator = ",") => toStringValue(value).split(toStringValue(separator)),
  },
  array: {
    length: (items: any) => normalizeArray(items).length,
    includes: (items: any, value: any) => normalizeArray(items).some((item) => String(item) === String(value)),
    first: (items: any) => normalizeArray(items)[0],
    last: (items: any) => {
      const arr = normalizeArray(items);
      return arr.length === 0 ? null : arr[arr.length - 1];
    },
    unique: (items: any) => {
      const arr = normalizeArray(items);
      const seen = new Set<string>();
      const out: any[] = [];
      arr.forEach((item) => {
        const key = JSON.stringify(item);
        if (seen.has(key)) return;
        seen.add(key);
        out.push(item);
      });
      return out;
    },
    compact: (items: any) =>
      normalizeArray(items).filter((item) => item !== null && item !== undefined && item !== ""),
    join: (items: any, separator = ",") => normalizeArray(items).map((item) => String(item)).join(toStringValue(separator)),
  },
});

export type HomeScriptCommonFunctionDescriptor = {
  namespace: string;
  name: string;
  fullName: string;
  arity: number;
  params: string[];
  signature: string;
};

const buildAutoParamNames = (arity: number): string[] => {
  if (arity <= 0) return [];
  return Array.from({ length: arity }, (_, idx) => `arg${idx + 1}`);
};

export const HOME_SCRIPT_COMMON_FUNCTIONS: HomeScriptCommonFunctionDescriptor[] = deepFreeze(
  Object.entries(HOME_SCRIPT_COMMON)
    .flatMap(([namespace, fns]) =>
      Object.entries(fns).map(([name, fn]) => {
        const arity = typeof fn === "function" ? Math.max(0, (fn as Function).length) : 0;
        const params = buildAutoParamNames(arity);
        return {
          namespace,
          name,
          fullName: `$COMMON.${namespace}.${name}`,
          arity,
          params,
          signature: `${name}(${params.join(", ")})`,
        };
      }),
    )
    .sort((a, b) => a.fullName.localeCompare(b.fullName)),
);

export const HOME_SCRIPT_COMMON_LLM_REFERENCE = [
  "Built-in helper library available in expressions as $COMMON:",
  ...HOME_SCRIPT_COMMON_FUNCTIONS.map((fn) => `- ${fn.fullName}(${fn.params.join(", ")})`),
].join("\n");

