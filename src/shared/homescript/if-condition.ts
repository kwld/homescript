import { shouldContinueIfCondition } from "./expression.js";

export type ScriptLine = { content: string; lineNumber: number };

export const collectIfCondition = (
  lines: ScriptLine[],
  startIndex: number,
  maxEnd: number,
): { condition: string; lastConditionLineIndex: number } => {
  const first = lines[startIndex];
  const match = first.content.match(/^IF\s+(.+)$/);
  if (!match) {
    throw new Error("Invalid IF syntax");
  }

  let condition = match[1].trim();
  let idx = startIndex;

  while (idx + 1 < maxEnd) {
    const next = lines[idx + 1].content;
    if (!next || next.startsWith("#")) {
      idx += 1;
      continue;
    }
    const kw = next.split(/\s+/)[0];
    if (kw === "ELSE" || kw === "END_IF" || kw === "FUNCTION" || kw === "WHILE" || kw === "CALL" || kw === "GET" || kw === "SET" || kw === "PRINT" || kw === "RETURN") {
      break;
    }
    if (!shouldContinueIfCondition(condition, next)) {
      break;
    }
    condition += ` ${next.trim()}`;
    idx += 1;
  }

  return {
    condition,
    lastConditionLineIndex: idx,
  };
};

