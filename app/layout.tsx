import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Discord Archive Viewer",
  description: "A private, offline viewer for Discord account data exports.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
