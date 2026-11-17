import { z } from "zod";

const ipOrCidr = z.union([z.ipv4(), z.ipv6(), z.cidrv4(), z.cidrv6()]);

export const IP_OR_CIDR_MESSAGE = "Enter an IPv4 or IPv6 address, or a CIDR range like 10.0.0.0/8";

export const isIpOrCidr = (value: string): boolean => ipOrCidr.safeParse(value.trim()).success;

const invalidIpEntries = (entries: readonly string[]): readonly string[] =>
  entries.filter((entry) => !isIpOrCidr(entry));

export const ipEntriesError = (entries: readonly string[] | undefined): string | undefined => {
  const invalid = invalidIpEntries(entries ?? []);
  return invalid.length === 0 ? undefined : `Not an IP address or CIDR range: ${invalid.join(", ")}`;
};
