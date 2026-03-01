export type HomeScriptDiagnostic = {
  line: number;
  message: string;
};

const isConfigBlockStart = (line: string) => /^@[a-zA-Z_][a-zA-Z0-9_]*\s*\{/.test(line);

const calculateBraceDelta = (line: string): number => {
  let delta = 0;
  let inSingle = false;
  let inDouble = false;
  let escaped = false;

  for (const ch of line) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (!inDouble && ch === "'") {
      inSingle = !inSingle;
      continue;
    }
    if (!inSingle && ch === '"') {
      inDouble = !inDouble;
      continue;
    }
    if (inSingle || inDouble) continue;
    if (ch === "{") delta += 1;
    if (ch === "}") delta -= 1;
  }

  return delta;
};

export const validateHomeScript = (code: string): HomeScriptDiagnostic[] => {
  const diagnostics: HomeScriptDiagnostic[] = [];
  const rawLines = code.split("\n");

  let declarationZoneActive = true;
  let metaBlockDepth = 0;
  const labelLines = new Map<string, number>();
  const gotoRefs: Array<{ label: string; line: number }> = [];
  const stack: Array<{ kind: "IF" | "WHILE" | "FUNCTION"; line: number }> = [];

  rawLines.forEach((raw, idx) => {
    const lineNumber = idx + 1;
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;

    if (metaBlockDepth > 0) {
      metaBlockDepth += calculateBraceDelta(line);
      if (metaBlockDepth < 0) metaBlockDepth = 0;
      return;
    }
    if (isConfigBlockStart(line)) {
      metaBlockDepth = calculateBraceDelta(line);
      if (metaBlockDepth < 0) metaBlockDepth = 0;
      return;
    }

    const isReqOpt = line.startsWith("REQUIRED ") || line.startsWith("OPTIONAL ");
    if (declarationZoneActive) {
      if (!isReqOpt) declarationZoneActive = false;
    } else if (isReqOpt) {
      diagnostics.push({ line: lineNumber, message: "REQUIRED/OPTIONAL must be at the top of script" });
    }

    if (line.startsWith("REQUIRED ") && !/^REQUIRED\s+\$[a-zA-Z0-9_]+(?:\s+IF\s*\([\s\S]+\))?$/.test(line)) {
      diagnostics.push({ line: lineNumber, message: "Invalid REQUIRED syntax. Use: REQUIRED $name [IF (...)]" });
    }
    if (line.startsWith("OPTIONAL ") && !/^OPTIONAL\s+\$[a-zA-Z0-9_]+(?:\s*=\s*.+)?(?:\s+IF\s*\([\s\S]+\))?$/.test(line)) {
      diagnostics.push({ line: lineNumber, message: "Invalid OPTIONAL syntax. Use: OPTIONAL $name [= default] [IF (...)]" });
    }

    const labelMatch = line.match(/^LABEL\s+([a-zA-Z_][a-zA-Z0-9_]*)$/);
    if (labelMatch) {
      const label = labelMatch[1];
      if (labelLines.has(label)) {
        diagnostics.push({ line: lineNumber, message: `Duplicate label: ${label}` });
      } else {
        labelLines.set(label, lineNumber);
      }
    } else if (line.startsWith("LABEL ")) {
      diagnostics.push({ line: lineNumber, message: "Invalid LABEL syntax. Use: LABEL name" });
    }

    const gotoMatch = line.match(/^GOTO\s+([a-zA-Z_][a-zA-Z0-9_]*)$/);
    if (gotoMatch) {
      gotoRefs.push({ label: gotoMatch[1], line: lineNumber });
    } else if (line.startsWith("GOTO ")) {
      diagnostics.push({ line: lineNumber, message: "Invalid GOTO syntax. Use: GOTO labelName" });
    }

    if (line.startsWith("BREAK ") && !/^BREAK\s+\d{3}(?:\s+.+)?$/.test(line)) {
      diagnostics.push({ line: lineNumber, message: "Invalid BREAK syntax. Use: BREAK 404 \"message\"" });
    }
    if (line.startsWith("TEST ")) {
      if (!/^TEST\s+.+(?:\s+INTO\s+\$[a-zA-Z0-9_]+)?$/.test(line)) {
        diagnostics.push({
          line: lineNumber,
          message: "Invalid TEST syntax. Use: TEST <value> /regex/flags [INTO $var]",
        });
      } else if (!/\/(?:\\.|[^\/\\\n]|\[(?:\\.|[^\]\\\n])*\])+\/[dgimsuvy]*/.test(line)) {
        diagnostics.push({
          line: lineNumber,
          message: "TEST requires regex literal in /pattern/flags format",
        });
      }
    }

    if (/^IF\b/.test(line)) stack.push({ kind: "IF", line: lineNumber });
    if (/^WHILE\b/.test(line)) stack.push({ kind: "WHILE", line: lineNumber });
    if (/^FUNCTION\b/.test(line)) stack.push({ kind: "FUNCTION", line: lineNumber });

    if (line === "END_IF") {
      const top = stack.pop();
      if (!top || top.kind !== "IF") diagnostics.push({ line: lineNumber, message: "END_IF without matching IF" });
    }
    if (line === "END_WHILE") {
      const top = stack.pop();
      if (!top || top.kind !== "WHILE") diagnostics.push({ line: lineNumber, message: "END_WHILE without matching WHILE" });
    }
    if (line === "END_FUNCTION") {
      const top = stack.pop();
      if (!top || top.kind !== "FUNCTION") diagnostics.push({ line: lineNumber, message: "END_FUNCTION without matching FUNCTION" });
    }
  });

  gotoRefs.forEach((ref) => {
    if (!labelLines.has(ref.label)) {
      diagnostics.push({ line: ref.line, message: `Unknown label: ${ref.label}` });
    }
  });

  stack.forEach((entry) => {
    diagnostics.push({ line: entry.line, message: `Missing terminator for ${entry.kind}` });
  });

  return diagnostics;
};
