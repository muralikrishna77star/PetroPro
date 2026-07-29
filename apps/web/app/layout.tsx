import type { Metadata, Viewport } from "next";
import { Inter, Poppins, Roboto_Mono } from "next/font/google";
import { RegisterServiceWorker } from "./register-sw";
import { DesktopTitleBar } from "@/components/DesktopTitleBar";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

const robotoMono = Roboto_Mono({
  variable: "--font-roboto-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "PetroPro",
  description: "The Complete Petrol Station Management Platform",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "PetroPro" },
};

export const viewport: Viewport = {
  themeColor: "#0b1220",
};

/** Dark is the true CSS default (no class needed — see globals.css); this only opts a
 *  returning visitor who chose light back into it before first paint, to avoid a flash. */
const themeInitScript = `
try {
  if (localStorage.getItem("petropro.theme") === "light") {
    document.documentElement.classList.add("light");
  }
} catch (e) {}
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${poppins.variable} ${robotoMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-full flex flex-col">
        <RegisterServiceWorker />
        <DesktopTitleBar />
        {children}
      </body>
    </html>
  );
}
