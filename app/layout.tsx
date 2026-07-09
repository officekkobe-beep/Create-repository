import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "仕訳日報管理",
  description: "仕訳作業の日報登録、マスタ管理、月次集計を行うWebアプリ"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
