import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Agency Workstation",
    template: "%s — Agency Workstation",
  },
  description:
    "Plataforma de producción para agencias: spec, artefactos versionados y aprobaciones humanas.",
};

/**
 * Tema oscuro por defecto (hero theme, §11.4); el claro se activa con la
 * clase `light` en <html>. Este script corre síncrono antes del primer paint
 * para evitar flash (ver guía preventing-flash-before-hydration de Next).
 */
const themeInitScript = `try{if(localStorage.getItem("aw-theme")==="light")document.documentElement.classList.add("light")}catch(e){}`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        {children}
      </body>
    </html>
  );
}
