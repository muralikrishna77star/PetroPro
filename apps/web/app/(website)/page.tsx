import Link from "next/link";
import {
  ArrowRight,
  Boxes,
  FileSpreadsheet,
  Fuel,
  Gauge,
  Mail,
  Phone,
  PlayCircle,
  Printer,
  Receipt,
  ShieldCheck,
  Smartphone,
  Users,
  WifiOff,
  type LucideIcon,
} from "lucide-react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { FEATURES, SALES_CONTACT, TOUR_SLIDES, WEBSITE_HOSTS } from "@/lib/marketing/productTour";
import { StaffRedirect } from "./StaffRedirect";

const FEATURE_ICONS: LucideIcon[] = [Smartphone, Receipt, Printer, Users, Gauge, FileSpreadsheet, Boxes, ShieldCheck, WifiOff];

const STEPS = [
  { title: "Attendant", text: "Enters the fill on a phone at the pump." },
  { title: "Cashier", text: "Sees it in the queue and settles the bill." },
  { title: "Receipt", text: "Prints silently, with your company's logo." },
  { title: "Books", text: "Stock, dues, shift cash and reports update." },
];

export default async function HomePage() {
  // A station's own address opens its app, not the website.
  const host = ((await headers()).get("host") ?? "").replace(/:\d+$/, "").toLowerCase();
  if (!WEBSITE_HOSTS.includes(host)) redirect("/start");

  return (
    <main>
      <StaffRedirect />

      {/* Hero */}
      <section className="gloss-hero px-4 pb-20 pt-16 text-white sm:pt-24">
        <div className="mx-auto grid max-w-7xl items-center gap-12 lg:grid-cols-2">
          <div>
            <p className="glass-pill mb-5 inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium text-orange-200">
              <Fuel className="h-4 w-4" aria-hidden="true" /> Fuel station management software
            </p>
            <h1 className="font-heading text-4xl font-bold leading-tight sm:text-5xl">
              Run your fuel station from <span className="gloss-text">forecourt to final report</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg text-slate-300">
              Attendant entry, billing, credit customers, thermal receipts, stock and GST for petrol bunks. On the counter PC and
              the attendant&apos;s phone.
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/tour"
                className="gloss-btn inline-flex items-center justify-center gap-2 rounded-xl px-7 py-3 font-semibold"
              >
                <PlayCircle className="h-5 w-5" aria-hidden="true" /> Take the Product Tour
              </Link>
              <Link
                href="/#contact"
                className="glass-btn inline-flex items-center justify-center gap-1.5 rounded-xl px-7 py-3 font-semibold"
              >
                Book a demo <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </div>
            <p className="mt-4 text-sm text-slate-400">{TOUR_SLIDES.length} slides · about 3 minutes · no sign-up needed</p>
          </div>

          <div className="relative pb-10 sm:pr-16">
            <Link href="/tour" aria-label="Open the Product Tour" className="gloss-frame relative block rounded-xl">
              {/* eslint-disable-next-line @next/next/no-img-element -- a static screenshot */}
              <img src="/assets/tour/dashboard.jpg" alt="PetroPro station dashboard with today's sales, bills, pending queue and customer dues" width={1440} height={900} className="h-auto w-full" />
            </Link>
            <div className="gloss-frame gloss-float absolute -bottom-2 right-0 hidden w-36 rounded-[1.4rem] border-4 border-slate-800 sm:block lg:w-40">
              {/* eslint-disable-next-line @next/next/no-img-element -- a static screenshot */}
              <img src="/assets/tour/attendant.jpg" alt="Attendant entry screen on a phone" width={390} height={844} className="h-auto w-full" />
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="gloss-section px-4 py-14">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-center font-heading text-2xl font-bold sm:text-3xl">One entry, from the pump to the books</h2>
          <ol className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s, i) => (
              <li key={s.title} className="gloss-card gloss-card-hover rounded-xl p-5">
                <span className="gloss-orb mb-3 inline-flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold">{i + 1}</span>
                <h3 className="font-semibold">{s.title}</h3>
                <p className="mt-1 text-sm text-slate-600">{s.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Tour teaser */}
      <section className="px-4 py-16">
        <div className="mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-2">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-orange-600">See it in action</p>
            <h2 className="mb-4 font-heading text-3xl font-bold">From the attendant&apos;s phone to the GST report, in one guided tour</h2>
            <p className="mb-6 text-slate-600">
              Walk through the screens your team will use every day: the attendant app, the cashier queue, billing, thermal
              receipts, credit statements, vehicle mileage, stock and the customer portal.
            </p>
            <Link href="/tour" className="gloss-btn-dark inline-flex items-center gap-2 rounded-xl px-6 py-3 font-semibold">
              Go through the tour <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
          <Link href="/tour#10" aria-label="Open the vehicle mileage slide of the Product Tour" className="gloss-frame gloss-frame-light group relative block rounded-xl">
            {/* eslint-disable-next-line @next/next/no-img-element -- a static screenshot */}
            <img
              src="/assets/tour/report-mileage.jpg"
              alt="Vehicle mileage report with kilometres per litre for each fill"
              width={1440}
              height={900}
              className="h-auto w-full transition-transform duration-300 group-hover:scale-[1.02]"
            />
          </Link>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="gloss-section scroll-mt-16 px-4 py-20">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-center font-heading text-3xl font-bold">Everything a petrol bunk needs</h2>
          <p className="mx-auto mb-12 mt-4 max-w-2xl text-center text-slate-500">
            Built with fuel station owners, from the business rules of the billing software they already know.
          </p>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f, i) => {
              const Icon = FEATURE_ICONS[i] ?? Fuel;
              return (
                <div key={f.title} className="gloss-card gloss-card-hover rounded-xl p-6">
                  <span className="gloss-orb-soft mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl">
                    <Icon className="h-5 w-5 text-orange-600" strokeWidth={2} aria-hidden="true" />
                  </span>
                  <h3 className="mb-2 text-lg font-semibold">{f.title}</h3>
                  <p className="text-sm text-slate-500">{f.text}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Contact */}
      <section id="contact" className="scroll-mt-16 px-4 py-20">
        <div className="mx-auto max-w-xl text-center">
          <h2 className="mb-4 font-heading text-3xl font-bold">See it on your station&apos;s data</h2>
          <p className="mb-8 text-slate-500">Call or write for a live demo, in person or online.</p>
          <div className="space-y-3 text-left">
            <a href={`mailto:${SALES_CONTACT.email}?subject=${encodeURIComponent("PetroPro demo")}`} className="gloss-card gloss-card-hover flex items-center gap-3 break-all rounded-xl px-5 py-4">
              <Mail className="h-5 w-5 shrink-0 text-orange-600" aria-hidden="true" />
              <span>{SALES_CONTACT.email}</span>
            </a>
            <a href={SALES_CONTACT.phoneHref} className="gloss-card gloss-card-hover flex items-center gap-3 rounded-xl px-5 py-4">
              <Phone className="h-5 w-5 shrink-0 text-orange-600" aria-hidden="true" />
              <span>{SALES_CONTACT.phone}</span>
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}
