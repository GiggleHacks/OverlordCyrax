import { describe, expect, test } from "bun:test";
import { extractTokenFromCookie, extractTokenFromHeader } from "./auth";
import { generateTotpCode } from "./mfa";
import {
  createUser,
  deleteUser,
  enableUserMfa,
  getUserById,
  setUserMfaSecret,
} from "./users";
import { handleAuthRoutes } from "./server/routes/auth-routes";

const PASSWORD = "Aa1!AuthMfaTest_2026";
const mockServer = {
  requestIP: () => ({ address: "127.0.0.1" }),
};

describe("auth token extraction", () => {
  test("extractTokenFromHeader returns bearer token", () => {
    expect(extractTokenFromHeader("Bearer abc123")).toBe("abc123");
    expect(extractTokenFromHeader("Basic abc123")).toBeNull();
  });

  test("extractTokenFromCookie finds overlord_token", () => {
    const cookie = "other=1; overlord_token=token123; theme=dark";
    expect(extractTokenFromCookie(cookie)).toBe("token123");
  });

  test("extractTokenFromCookie returns null when missing", () => {
    expect(extractTokenFromCookie("foo=bar")).toBeNull();
  });
});

describe("login branding", () => {
  test("returns default public login branding", async () => {
    const url = new URL("https://localhost/api/login/branding");
    const res = await handleAuthRoutes(new Request(url), url, mockServer);
    expect(res?.status).toBe(200);

    const body = (await res!.json()) as any;
    expect(body.productName).toBe("Overlord");
    expect(body.title).toBe("Welcome back");
    expect(body.logoUrl).toBe("");
  });
});

describe("auth MFA login", () => {
  test("MFA-enabled user gets a challenge and can login with TOTP", async () => {
    const username = `mfa_user_${Date.now().toString(36)}`;
    const created = await createUser(username, PASSWORD, "operator", "test");
    expect(created.success).toBe(true);

    try {
      const secret = "JBSWY3DPEHPK3PXP";
      expect(setUserMfaSecret(created.userId!, secret).success).toBe(true);
      expect(enableUserMfa(created.userId!).success).toBe(true);

      const url = new URL("https://localhost/api/login");
      const challenge = await handleAuthRoutes(
        new Request(url, {
          method: "POST",
          body: JSON.stringify({ user: username, pass: PASSWORD }),
        }),
        url,
        mockServer,
      );
      expect(challenge?.status).toBe(202);
      expect((await challenge!.json()).mfaRequired).toBe(true);

      const login = await handleAuthRoutes(
        new Request(url, {
          method: "POST",
          body: JSON.stringify({
            user: username,
            pass: PASSWORD,
            mfaCode: generateTotpCode(secret),
          }),
        }),
        url,
        mockServer,
      );
      expect(login?.status).toBe(200);
      const body = (await login!.json()) as any;
      expect(body.ok).toBe(true);
      expect(body.token).toBeTruthy();
      expect(getUserById(created.userId!)).not.toBeNull();
    } finally {
      deleteUser(created.userId!);
    }
  });
});
