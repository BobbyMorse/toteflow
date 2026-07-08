import "./globals.css";
import type { Metadata } from "next";
import Nav from "@/components/Nav";

export const metadata: Metadata = {
  title: "ToteFlow — Live Tote Market Intelligence",
  description: "Real-time sharp money tracking for horse racing.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <Nav />
        <main className="max-w-[1600px] mx-auto px-3 sm:px-4 pb-24">{children}</main>
      </body>
    </html>
  );
}
