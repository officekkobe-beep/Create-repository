import { describe, expect, it } from "vitest";
import { hardenCookieOptions, isAllowedAdminEmail, isSameOrigin } from "./admin-guard";

const headers = (map: Record<string, string>) => ({ get: (name: string) => map[name.toLowerCase()] ?? null });

describe("isAllowedAdminEmail", () => {
  it("許可リストと大文字小文字を区別せず一致", () => {
    expect(isAllowedAdminEmail("Admin@Example.com", "admin@example.com")).toBe(true);
    expect(isAllowedAdminEmail("b@example.com", "a@example.com, b@example.com")).toBe(true);
  });
  it("未設定・不一致・空は拒否", () => {
    expect(isAllowedAdminEmail("x@example.com", "admin@example.com")).toBe(false);
    expect(isAllowedAdminEmail("x@example.com", undefined)).toBe(false);
    expect(isAllowedAdminEmail(undefined, "admin@example.com")).toBe(false);
    expect(isAllowedAdminEmail("x@example.com", "")).toBe(false);
  });
});

describe("isSameOrigin（CSRF対策）", () => {
  it("GETは常に許可", () => {
    expect(isSameOrigin({ method: "GET", headers: headers({}) })).toBe(true);
  });
  it("変更系はOriginとHostが一致する場合のみ許可", () => {
    expect(isSameOrigin({ method: "POST", headers: headers({ origin: "https://app.example.com", host: "app.example.com" }) })).toBe(true);
    expect(isSameOrigin({ method: "POST", headers: headers({ origin: "https://evil.example.net", host: "app.example.com" }) })).toBe(false);
    expect(isSameOrigin({ method: "DELETE", headers: headers({ host: "app.example.com" }) })).toBe(false);
    expect(isSameOrigin({ method: "POST", headers: headers({ origin: "not a url", host: "app.example.com" }) })).toBe(false);
  });
  it("x-forwarded-host を優先", () => {
    expect(isSameOrigin({ method: "POST", headers: headers({ origin: "https://app.example.com", host: "internal", "x-forwarded-host": "app.example.com" }) })).toBe(true);
  });
});

describe("hardenCookieOptions", () => {
  it("HttpOnly・SameSite=Strict・path=/ を強制し、本番ではSecure", () => {
    const options = hardenCookieOptions({ httpOnly: false, sameSite: "lax", maxAge: 100 }, true);
    expect(options).toMatchObject({ httpOnly: true, sameSite: "strict", secure: true, path: "/", maxAge: 100 });
    expect(hardenCookieOptions(undefined, false).secure).toBe(false);
  });
});
