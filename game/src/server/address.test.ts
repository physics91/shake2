import { describe, expect, it } from "vitest";

import { addressKey, clientAddress, isLoopbackAddress, isLoopbackHost } from "./address.ts";

describe("addressKey", () => {
  it("keeps an IPv4 address, also one mapped into IPv6", () => {
    expect(addressKey("203.0.113.5")).toBe("203.0.113.5");
    expect(addressKey("::ffff:203.0.113.5")).toBe("203.0.113.5");
    expect(addressKey("::FFFF:127.0.0.1")).toBe("127.0.0.1");
  });

  it("groups an IPv6 address by its /64, however it is written", () => {
    expect(addressKey("2001:db8:1:2:3:4:5:6")).toBe("2001:db8:1:2::/64");
    expect(addressKey("2001:DB8:1:2::9")).toBe("2001:db8:1:2::/64");
    expect(addressKey("[2001:db8::1]")).toBe("2001:db8:0:0::/64");
    expect(addressKey("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
    expect(addressKey("::1")).toBe("0:0:0:0::/64");
    expect(addressKey("1::")).toBe("1:0:0:0::/64");
    expect(addressKey("a:b::c:d")).toBe("a:b:0:0::/64");
    expect(addressKey("64:ff9b::1.2.3.4")).toBe("64:ff9b:0:0::/64");
    expect(addressKey("1:2:3:4:5:6:1.2.3.4")).toBe("1:2:3:4::/64");
  });

  it("keeps anything else as it came", () => {
    expect(addressKey("")).toBe("");
    expect(addressKey("not an address")).toBe("not an address");
    expect(addressKey("1:2:3")).toBe("1:2:3");
  });
});

describe("isLoopbackAddress", () => {
  it("knows 127/8 and ::1, mapped or not", () => {
    for (const address of ["127.0.0.1", "127.1.2.3", "::1", "::ffff:127.0.0.1", "0:0:0:0:0:0:0:1"]) {
      expect(isLoopbackAddress(address)).toBe(true);
    }
    for (const address of ["10.0.0.1", "::2", "128.0.0.1", "", "localhost"]) expect(isLoopbackAddress(address)).toBe(false);
  });
});

describe("clientAddress", () => {
  it("takes the socket's address when it is not a proxy it trusts, whatever the header says", () => {
    expect(clientAddress("203.0.113.5", "1.1.1.1", [])).toBe("203.0.113.5");
    expect(clientAddress("10.0.0.3", "203.0.113.5", ["10.0.0.2"])).toBe("10.0.0.3");
    expect(clientAddress("127.0.0.1", undefined, [])).toBe("127.0.0.1");
  });

  it("takes the address a trusted proxy saw: loopback, or one listed", () => {
    expect(clientAddress("127.0.0.1", "203.0.113.5", [])).toBe("203.0.113.5");
    expect(clientAddress("::ffff:127.0.0.1", "203.0.113.5", [])).toBe("203.0.113.5");
    expect(clientAddress("10.0.0.2", ["203.0.113.5"], ["10.0.0.2"])).toBe("203.0.113.5");
  });

  it("walks back over trusted proxies only, so a forged entry on the left is not reached", () => {
    expect(clientAddress("127.0.0.1", "9.9.9.9, 203.0.113.5", [])).toBe("203.0.113.5");
    expect(clientAddress("127.0.0.1", "203.0.113.5, 10.0.0.2", ["10.0.0.2"])).toBe("203.0.113.5");
    expect(clientAddress("127.0.0.1", " , ", [])).toBe("127.0.0.1");
  });
});

describe("isLoopbackHost", () => {
  it("tells a listen host reachable only from this machine", () => {
    for (const host of ["127.0.0.1", "localhost", "::1", "[::1]"]) expect(isLoopbackHost(host)).toBe(true);
    for (const host of ["0.0.0.0", "::", "192.168.0.2", ""]) expect(isLoopbackHost(host)).toBe(false);
  });
});
