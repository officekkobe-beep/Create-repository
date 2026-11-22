import { createHash, randomBytes } from "node:crypto";

// 共有リンクのトークンはDBにハッシュだけを保存する。平文は発行時に一度だけ管理者へ返す。
export function generateShareToken() {
  return randomBytes(32).toString("base64url");
}

export function hashShareToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
