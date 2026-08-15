import type { Address } from "postal-mime";

export function mailboxEmails(addrs: Address[] | undefined): string[] {
  if (!addrs?.length) return [];
  const emails: string[] = [];
  for (const addr of addrs) {
    if (addr.group) {
      for (const member of addr.group) {
        if (member.address) emails.push(member.address.toLowerCase());
      }
      continue;
    }
    if (addr.address) emails.push(addr.address.toLowerCase());
  }
  return emails;
}

export function mailboxEmail(addr: Address | undefined): string | undefined {
  if (!addr) return undefined;
  if (addr.group) return addr.group.find((member) => member.address)?.address;
  return addr.address;
}
