import { describe, expect, it } from "vitest";
import { isIpAllowedByWhitelist, isValidIpOrCidr } from "./ip-whitelist.js";

describe("ip whitelist utils", () => {
  it("validates ip/cidr values", () => {
    expect(isValidIpOrCidr("127.0.0.1")).toBe(true);
    expect(isValidIpOrCidr("192.168.0.0/24")).toBe(true);
    expect(isValidIpOrCidr("0.0.0.0/0")).toBe(true);
    expect(isValidIpOrCidr("255.255.255.255/32")).toBe(true);
    expect(isValidIpOrCidr("2001:db8::/64")).toBe(true);
    expect(isValidIpOrCidr("::1/128")).toBe(true);
    expect(isValidIpOrCidr("10.0.0.0/33")).toBe(false);
    expect(isValidIpOrCidr("2001:db8::/129")).toBe(false);
    expect(isValidIpOrCidr("192.168.1.1/-1")).toBe(false);
    expect(isValidIpOrCidr("192.168.1.256/24")).toBe(false);
    expect(isValidIpOrCidr("not-an-ip")).toBe(false);
  });

  it("matches ipv4 exact and cidr entries", () => {
    expect(isIpAllowedByWhitelist("127.0.0.1", ["127.0.0.1"])).toBe(true);
    expect(isIpAllowedByWhitelist("192.168.1.25", ["192.168.1.0/24"])).toBe(true);
    expect(isIpAllowedByWhitelist("192.168.2.25", ["192.168.1.0/24"])).toBe(false);
  });

  it("matches ipv6 exact and cidr entries", () => {
    expect(isIpAllowedByWhitelist("::1", ["::1/128"])).toBe(true);
    expect(isIpAllowedByWhitelist("2001:db8::2", ["2001:db8::/64"])).toBe(true);
    expect(isIpAllowedByWhitelist("2001:db9::2", ["2001:db8::/64"])).toBe(false);
  });
});
