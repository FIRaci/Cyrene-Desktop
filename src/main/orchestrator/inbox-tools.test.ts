import { describe, it, expect, beforeEach } from "vitest";
import {
  setInboxConfig,
  fetchUnreadEmailsSummary,
} from "./inbox-tools";

describe("InboxTools", () => {
  beforeEach(() => {
    setInboxConfig({
      enabledGetter: () => false,
      userGetter: () => "",
      passGetter: () => "",
      hostGetter: () => "",
    });
  });

  it("returns helpful notice when email is disabled in settings", async () => {
    const res = await fetchUnreadEmailsSummary(5);
    expect(res).toContain("[Notice]");
    expect(res).toContain("Email digest is not active");
  });

  it("returns notice when email credentials are empty", async () => {
    setInboxConfig({
      enabledGetter: () => true,
      userGetter: () => "",
      passGetter: () => "",
      hostGetter: () => "smtp.gmail.com",
    });
    const res = await fetchUnreadEmailsSummary(5);
    expect(res).toContain("[Notice]");
    expect(res).toContain("configure your email account");
  });

  it("gracefully catches network failure for invalid host", async () => {
    setInboxConfig({
      enabledGetter: () => true,
      userGetter: () => "user@example.com",
      passGetter: () => "app-password-123",
      hostGetter: () => "127.0.0.1:9999", // Unbound port
    });
    const res = await fetchUnreadEmailsSummary(3);
    expect(res).toBeDefined();
    expect(typeof res).toBe("string");
  });
});
