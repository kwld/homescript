import { HOME_SCRIPT_COMMON_FUNCTIONS } from "./common-lib.js";

type MonacoLike = any;
type MonacoRange = any;

export const createCommonLibMonacoSuggestionFactory = (monaco: MonacoLike) => {
  return (range: MonacoRange) => {
    const functionKind = monaco.languages.CompletionItemKind.Function;
    const moduleKind = monaco.languages.CompletionItemKind.Module;

    const namespaceSuggestions = Array.from(
      new Set(HOME_SCRIPT_COMMON_FUNCTIONS.map((fn) => `$COMMON.${fn.namespace}`)),
    ).map((label) => ({
      label,
      kind: moduleKind,
      insertText: label,
      range,
      detail: "HomeScript Common Namespace",
    }));

    const functionSuggestions = HOME_SCRIPT_COMMON_FUNCTIONS.map((fn) => {
      const placeholders = fn.params.map((param, idx) => `\${${idx + 1}:${param}}`);
      const insertText = `${fn.fullName}(${placeholders.join(", ")})`;
      return {
        label: fn.fullName,
        kind: functionKind,
        insertText,
        insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
        range,
        detail: `HomeScript Common Helper: ${fn.signature}`,
      };
    });

    return [...namespaceSuggestions, ...functionSuggestions];
  };
};

