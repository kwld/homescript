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

export const HOME_SCRIPT_ENUMS = deepFreeze({
  state: {
    on: "on",
    off: "off",
    unknown: "unknown",
    unavailable: "unavailable",
  },
});
