/**
 * Client addresses for the lobby's password guard (R: the original server's is not known). One
 * key stands for everyone behind an IPv4 address or an IPv6 /64, the least a single user usually
 * holds, so opening more connections or taking another address from the same line buys nothing.
 */

type Parsed = { v4: number[] } | { v6: number[] };

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const HEX_GROUP = /^[0-9a-f]{1,4}$/i;

function parseV4(text: string): number[] | null {
  const match = IPV4.exec(text);
  if (!match) return null;
  const octets = match.slice(1).map(Number);
  return octets.every((o) => o <= 255) ? octets : null;
}

function parseGroups(text: string): number[] | null {
  if (text === "") return [];
  const parts = text.split(":");
  const groups: number[] = [];
  for (const [i, part] of parts.entries()) {
    const v4 = i === parts.length - 1 ? parseV4(part) : null;
    if (v4) groups.push((v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]);
    else if (HEX_GROUP.test(part)) groups.push(parseInt(part, 16));
    else return null;
  }
  return groups;
}

function parseV6(text: string): number[] | null {
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = parseGroups(halves[0]);
  const tail = halves.length === 2 ? parseGroups(halves[1]) : [];
  if (!head || !tail) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const missing = 8 - head.length - tail.length;
  return missing >= 1 ? [...head, ...new Array<number>(missing).fill(0), ...tail] : null;
}

/** An address as a socket or a proxy gives it: brackets and an IPv6 zone are dropped. */
function parse(raw: string): Parsed | null {
  const text = raw.trim().replace(/^\[(.*)\]$/, "$1").replace(/%.*$/, "");
  const v4 = parseV4(text);
  if (v4) return { v4 };
  const v6 = parseV6(text);
  if (!v6) return null;
  const mapped = v6.slice(0, 5).every((g) => g === 0) && v6[5] === 0xffff;
  return mapped ? { v4: [v6[6] >> 8, v6[6] & 0xff, v6[7] >> 8, v6[7] & 0xff] } : { v6 };
}

/** The address written one way only, to compare it with another. */
function canonical(raw: string): string {
  const parsed = parse(raw);
  if (!parsed) return raw.trim();
  return "v4" in parsed ? parsed.v4.join(".") : parsed.v6.map((g) => g.toString(16)).join(":");
}

/** The guard's key: an IPv4 address (also one mapped into IPv6), an IPv6 /64, else the text itself. */
export function addressKey(raw: string): string {
  const parsed = parse(raw);
  if (!parsed) return raw;
  if ("v4" in parsed) return parsed.v4.join(".");
  return `${parsed.v6
    .slice(0, 4)
    .map((g) => g.toString(16))
    .join(":")}::/64`;
}

export function isLoopbackAddress(raw: string): boolean {
  const parsed = parse(raw);
  if (!parsed) return false;
  if ("v4" in parsed) return parsed.v4[0] === 127;
  return parsed.v6.slice(0, 7).every((g) => g === 0) && parsed.v6[7] === 1;
}

/** A listen host that only this machine can reach. */
export function isLoopbackHost(host: string): boolean {
  return host.trim().toLowerCase() === "localhost" || isLoopbackAddress(host);
}

/**
 * The client's address: the socket's, or, while the socket is a proxy trusted here (loopback, such
 * as the dev and preview servers' proxy, or one listed), the X-Forwarded-For entry that proxy
 * added. Entries are read from the right, so one the client wrote on the left is never reached.
 */
export function clientAddress(
  socket: string | undefined,
  forwardedFor: string | readonly string[] | undefined,
  trustedProxies: readonly string[],
): string {
  const trusted = new Set(trustedProxies.map(canonical));
  const forwarded = [forwardedFor ?? []]
    .flat()
    .join(",")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
  const chain = [...forwarded, socket ?? ""];
  let at = chain.length - 1;
  while (at > 0 && (isLoopbackAddress(chain[at]) || trusted.has(canonical(chain[at])))) at--;
  return chain[at];
}
