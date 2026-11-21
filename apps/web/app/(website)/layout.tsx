import type { Metadata } from "next";
import Link from "next/link";
import { SITE_URL } from "@/lib/marketing/productTour";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "PetroPro: fuel station billing and management software",
  description:
    "Attendant app, counter billing, thermal receipts, credit customers, vehicle mileage, stock and GST reports for petrol bunks. Works on the counter PC and the attendant's phone.",
  openGraph: {
    title: "PetroPro: run your fuel station from forecourt to final report",
    description: "Billing, credit customers, thermal receipts, stock and GST for petrol bunks.",
    url: SITE_URL,
    siteName: "PetroPro",
    images: [{ url: "/assets/tour/dashboard.jpg", width: 1440, height: 900, alt: "PetroPro station dashboard" }],
    locale: "en_IN",
    type: "website",
  },
};

/** The public website. Fixed light colours, so a visitor sees the same page whatever theme the
 *  staff app last used on this browser. */
export default function WebsiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-white text-slate-900 [color-scheme:light]">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur print:hidden">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element -- a fixed 32 px app icon */}
            <img src="/icons/icon-192.png" alt="" width={32} height={32} className="h-8 w-8 rounded-lg" />
            <span className="font-heading text-lg font-bold text-slate-900">PetroPro</span>
          </Link>
          <nav className="flex items-center gap-1 sm:gap-6" aria-label="Main">
            <Link href="/tour" className="rounded-lg px-2 py-2 text-sm font-semibold text-orange-600 hover:text-orange-700">
              Product Tour
            </Link>
            <Link href="/#features" className="hidden text-sm text-slate-600 hover:text-slate-900 md:inline">
              Features
            </Link>
            <Link href="/#contact" className="hidden text-sm text-slate-600 hover:text-slate-900 md:inline">
              Contact
            </Link>
            <Link href="/login" className="inline-flex items-center rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 sm:px-4">
              Staff Login
            </Link>
          </nav>
        </div>
      </header>
      <div className="flex-1">{children}</div>
      <footer className="border-t border-slate-200 py-8 print:hidden">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 px-4 text-sm text-slate-500 sm:flex-row sm:px-6 lg:px-8">
          <p>© {new Date().getFullYear()} PetroPro. Fuel station management software.</p>
          <div className="flex gap-5">
            <Link href="/tour" className="hover:text-slate-800">Product Tour</Link>
            <Link href="/customer/login" className="hover:text-slate-800">Customer Login</Link>
            <Link href="/login" className="hover:text-slate-800">Staff Login</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
