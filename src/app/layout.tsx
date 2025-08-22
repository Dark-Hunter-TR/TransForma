import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "@/styles/globals.css";
import { Toaster, toast } from 'sonner';

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Transforma - Online File Converter",
  description: "Convert your files easily between PDF, DOCX, XLSX, images, JSON, YAML, CSV, and more formats instantly online.",
  keywords: [
    "file converter",
    "online file conversion",
    "PDF to DOCX",
    "image converter",
    "JSON to YAML",
    "CSV converter",
    "online tools",
    "free file converter"
  ],
  authors: [
    { name: "Dark_Hunter", url: "https://github.com/Dark-Hunter-TR" }
  ],
  creator: "Dark_Hunter",
  publisher: "Transforma",
  openGraph: {
    title: "Transforma - Online File Converter",
    description: "Easily convert PDF, DOCX, XLSX, images, JSON, YAML, CSV, and more online.",
    siteName: "Transforma",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      <Toaster
        position="top-right"
        richColors
        closeButton
      />
      </body>
    </html>
  );
}
