import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./fonts.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dino Jump — Arcade Kiosk",
  description:
    "Dino Jump arcade game with touchscreen + Arduino joystick controls, live scores and Top 10 leaderboard.",
  icons: { icon: "/images/logo.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[#0b0620] text-white antialiased">
        {children}
      </body>
    </html>
  );
}
