import type { Metadata } from "next";
import {
  Instrument_Serif,
  Familjen_Grotesk,
  JetBrains_Mono,
} from "next/font/google";
import "./globals.css";
import Sidebar from "@/components/Sidebar";

const instrumentSerif = Instrument_Serif({
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-instrument-serif",
  subsets: ["latin"],
});

const familjenGrotesk = Familjen_Grotesk({
  variable: "--font-familjen",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ShikksTracker",
  description: "Email outreach automation dashboard",
  icons: {
    icon: "/logo-square.png",
    apple: "/logo-square.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${instrumentSerif.variable} ${familjenGrotesk.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="flex h-screen overflow-hidden bg-paper text-ink font-sans">
        <Sidebar />
        <main className="flex-1 overflow-y-auto bg-paper">
          {children}
        </main>
      </body>
    </html>
  );
}
