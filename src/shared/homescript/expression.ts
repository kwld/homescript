const stripStrings = (expr: string) => expr.replace(/"[^"]*"/g, "");

const hasTrailingLogicalOperator = (expr: string) => {
  const bare = stripStrings(expr).trim().toUpperCase();
  return /\b(AND|OR|NOT)\s*$/.test(bare) || bare.endsWith("&&") || bare.endsWith("||") || bare.endsWith("!");
};

export const lineStartsWithLogicalOperator = (line: string) => {
  const bare = stripStrings(line).trim().toUpperCase();
  return /^(AND|OR|NOT)\b/.test(bare) || bare.startsWith("&&") || bare.startsWith("||") || bare.startsWith("!");
};

export const shouldContinueIfCondition = (currentExpr: string, nextLine: string) =>
  hasTrailingLogicalOperator(currentExpr) || lineStartsWithLogicalOperator(nextLine);

const normalizeOperators = (expr: string) => {
  let s = expr;
  s = s.replace(/\bIN\b/gi, "__HS_IN__");
  s = s.replace(/\bAND\b/gi, "&&");
  s = s.replace(/\bOR\b/gi, "||");
  s = s.replace(/\bNOT\b/gi, "!");
  s = s.replace(/\bTRUE\b/gi, "true");
  s = s.replace(/\bFALSE\b/gi, "false");
  // Convert single '=' to '==' while preserving >= <= != ==
  s = s.replace(/(?<![!<>=])=(?!=)/g, "==");
  return s;
};

const injectVariables = (expr: string) => {
  const tokenRegex = /("[^"]*")|\$([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)*)/g;
  return expr.replace(tokenRegex, (match, stringLiteral, varPath) => {
    if (stringLiteral) return stringLiteral;
    if (varPath) return `__getVar__("${varPath}")`;
    return match;
  });
};

const transformInOperator = (expr: string) => {
  const operand = `(?:\\$[a-zA-Z0-9_.]+|"(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*'|\\[[^\\]]*\\]|\\([^\\)]*\\)|[a-zA-Z0-9_.-]+)`;
  const pattern = new RegExp(`(${operand})\\s+__HS_IN__\\s+(${operand})`, "g");
  let transformed = expr;
  let previous = "";
  while (previous !== transformed) {
    previous = transformed;
    transformed = transformed.replace(pattern, "__in__($1,$2)");
  }
  return transformed;
};

export const toJavaScriptExpression = (expr: string) => {
  const normalized = normalizeOperators(expr);
  const withIn = transformInOperator(normalized);
  return injectVariables(withIn);
};

export const evaluateHomeScriptExpression = (expr: string, variables: Record<string, any>) => {
  const jsExpr = toJavaScriptExpression(expr);
  const mathKeys = Object.getOwnPropertyNames(Math);
  const mathValues = mathKeys.map((key) => (Math as any)[key]);
  const getVarHelper = (path: string) => {
    const parts = String(path).split(".");
    let current: any = variables;
    for (const part of parts) {
      if (current === null || current === undefined || typeof current !== "object") return undefined;
      current = current[part];
    }
    return current;
  };
  const inHelper = (needle: any, haystack: any) => {
    if (Array.isArray(haystack)) return haystack.map((v) => String(v)).includes(String(needle));
    if (typeof haystack === "string") return haystack.includes(String(needle));
    if (haystack && typeof haystack === "object") return Object.prototype.hasOwnProperty.call(haystack, String(needle));
    return false;
  };
  const func = new Function(...mathKeys, "__vars__", "__in__", "__getVar__", `return (${jsExpr})`);
  return func(...mathValues, variables, inHelper, getVarHelper);
};
