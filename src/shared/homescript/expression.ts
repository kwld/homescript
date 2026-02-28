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
  const tokenRegex = /("[^"]*")|\$([a-zA-Z0-9_]+)/g;
  return expr.replace(tokenRegex, (match, stringLiteral, varName) => {
    if (stringLiteral) return stringLiteral;
    if (varName) return `__vars__["${varName}"]`;
    return match;
  });
};

export const toJavaScriptExpression = (expr: string) => injectVariables(normalizeOperators(expr));

export const evaluateHomeScriptExpression = (expr: string, variables: Record<string, any>) => {
  const jsExpr = toJavaScriptExpression(expr);
  const mathKeys = Object.getOwnPropertyNames(Math);
  const mathValues = mathKeys.map((key) => (Math as any)[key]);
  const func = new Function(...mathKeys, "__vars__", `return (${jsExpr})`);
  return func(...mathValues, variables);
};

