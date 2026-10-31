import { describe, expect, it } from "vitest";
import { ipEntriesError, isIpOrCidr } from "./ipAddress";

describe("isIpOrCidr", () => {
  it.each([
    "10.0.0.1",
    "10.0.0.0/8",
    "10.0.0.5/8",
    "0.0.0.0/0",
    "2001:db8::1",
    "2001:db8::/32",
    "::1",
    "::/0",
    "::ffff:192.0.2.1",
    " 192.168.1.1 ",
  ])("accepts %s", (value) => {
    expect(isIpOrCidr(value)).toBe(true);
  });

  it.each([
    "",
    "localhost",
    "256.1.1.1",
    "1.2.3",
    "10.0.0.01",
    "10.0.0.0/33",
    "10.0.0.0/",
    "2001:db8::/129",
    "2001:db8:::1",
    "10.0.0.0/8, 192.168.0.0/16",
  ])("rejects %s", (value) => {
    expect(isIpOrCidr(value)).toBe(false);
  });
});

describe("ipEntriesError", () => {
  it("is undefined for an empty or all-valid list", () => {
    expect(ipEntriesError(undefined)).toBeUndefined();
    expect(ipEntriesError([])).toBeUndefined();
    expect(ipEntriesError(["10.0.0.0/8", "::1"])).toBeUndefined();
  });

  it("names every invalid entry and none of the valid ones", () => {
    expect(ipEntriesError(["10.0.0.0/8", "bogus", "300.0.0.1"])).toBe(
      "Not an IP address or CIDR range: bogus, 300.0.0.1",
    );
  });
});
