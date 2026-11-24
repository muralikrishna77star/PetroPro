import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Lightbulb, LogIn, MapPin } from "lucide-react";
import type { Screen } from "@/lib/marketing/productTour";
import { DAY_FLOW, GUIDE_CHAPTERS, GUIDE_ROLES, ROLE_NAMES, type GuideChapter } from "@/lib/marketing/productGuide";
import { PrintButton } from "./PrintButton";

export const metadata: Metadata = {
  title: "Product Tour Guide: PetroPro",
  description:
    "How to use PetroPro, screen by screen: attendant entry, the cashier queue, billing, shifts, credit customers, purchases, rate changes, reports, printing and settings.",
};

export default function ProductGuidePage() {
  return (
    <main className="bg-slate-50 print:bg-white">
      {/* Intro */}
      <section className="bg-gradient-to-br from-slate-950 via-slate-900 to-blue-950 text-white print:[print-color-adjust:exact]">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
          <p className="mb-3 text-sm font-semibold uppercase tracking-wider text-orange-300">Product Tour Guide</p>
          <h1 className="mb-4 max-w-3xl font-heading text-3xl font-bold leading-tight sm:text-4xl">
            How to use PetroPro, screen by screen
          </h1>
          <p className="max-w-3xl text-lg text-slate-300">
            A walk through every part of the app for attendants, cashiers, owners and administrators: what each screen is for,
            who can open it, and the steps to get the job done.
          </p>
          <div className="mt-8 flex flex-wrap gap-3 print:hidden">
            <Link
              href="/login"
              className="inline-flex items-center gap-1.5 rounded-lg bg-orange-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-orange-600"
            >
              <LogIn className="h-4 w-4" aria-hidden="true" /> Staff Login
            </Link>
            <PrintButton />
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        {/* Roles */}
        <section aria-labelledby="roles" className="mb-12">
          <h2 id="roles" className="mb-2 font-heading text-2xl font-bold">Who sees what</h2>
          <p className="mb-6 max-w-3xl text-slate-600">
            Sign in with the user ID and password your administrator gave you. PetroPro opens the screen for your role, and
            the menu shows only the screens your role can use.
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {GUIDE_ROLES.map((r) => (
              <div key={r.key} className="rounded-xl border border-slate-200 bg-white p-5 print:[break-inside:avoid]">
                <h3 className="font-semibold">{r.name}</h3>
                <p className="mb-3 text-sm text-slate-500">{r.also}</p>
                <p className="mb-2 text-sm text-slate-700">{r.sees}</p>
                <p className="text-xs text-slate-500">
                  Opens on: <span className="font-medium text-slate-700">{r.starts}</span>
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* A day at the station */}
        <section aria-labelledby="day" className="mb-12 print:[break-inside:avoid]">
          <h2 id="day" className="mb-2 font-heading text-2xl font-bold">A day at the station</h2>
          <p className="mb-6 max-w-3xl text-slate-600">The usual order of things. Click a step to read how it&apos;s done.</p>
          <ol className="grid gap-3 sm:grid-cols-5">
            {DAY_FLOW.map((s, i) => (
              <li key={s.title}>
                <a
                  href={`#${s.chapter}`}
                  className="block h-full rounded-xl border-2 border-orange-100 bg-white p-4 transition-colors hover:border-orange-300"
                >
                  <span className="mb-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-orange-500 text-sm font-bold text-white print:[print-color-adjust:exact]">
                    {i + 1}
                  </span>
                  <h3 className="mb-1 font-semibold">{s.title}</h3>
                  <p className="text-sm text-slate-600">{s.text}</p>
                </a>
              </li>
            ))}
          </ol>
        </section>

        <div className="lg:grid lg:grid-cols-[13rem_1fr] lg:gap-10">
          {/* Contents */}
          <nav aria-label="Guide contents" className="mb-10 lg:mb-0 print:hidden">
            <div className="lg:sticky lg:top-24">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Contents</p>
              <ol className="flex flex-wrap gap-2 lg:flex-col lg:gap-1">
                {GUIDE_CHAPTERS.map((c, i) => (
                  <li key={c.id}>
                    <a
                      href={`#${c.id}`}
                      className="block rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 hover:border-orange-300 hover:text-orange-700 lg:border-transparent lg:bg-transparent lg:px-2"
                    >
                      <span className="mr-1.5 tabular-nums text-slate-400">{i + 1}.</span>
                      {c.nav}
                    </a>
                  </li>
                ))}
              </ol>
            </div>
          </nav>

          {/* Chapters */}
          <div className="min-w-0 space-y-10">
            {GUIDE_CHAPTERS.map((c, i) => (
              <Chapter key={c.id} chapter={c} number={i + 1} />
            ))}

            <section className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 print:hidden">
              <h2 className="mb-2 font-heading text-xl font-bold">Ready to start?</h2>
              <p className="mb-5 text-slate-600">
                Sign in with your PetroPro account. If you don&apos;t have one yet, ask your station&apos;s administrator.
              </p>
              <div className="flex flex-wrap gap-3">
                <Link href="/login" className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-700">
                  Staff Login <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
                <Link href="/customer/login" className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
                  Customer Login
                </Link>
              </div>
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}

function Chapter({ chapter: c, number }: { chapter: GuideChapter; number: number }) {
  const isPhone = c.image.width < c.image.height;
  return (
    <section id={c.id} aria-labelledby={`${c.id}-title`} className="scroll-mt-24 rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 print:break-before-page print:border-0 print:p-0">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-orange-600">
        {number}. {c.nav}
      </p>
      <h2 id={`${c.id}-title`} className="mb-3 font-heading text-2xl font-bold">{c.title}</h2>
      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
        {c.roles.length > 0 ? (
          c.roles.map((r) => (
            <span key={r} className="rounded-full bg-slate-100 px-2.5 py-1 font-medium text-slate-700">
              {ROLE_NAMES[r]}
            </span>
          ))
        ) : (
          <span className="rounded-full bg-slate-100 px-2.5 py-1 font-medium text-slate-700">Credit customers</span>
        )}
        <span className="inline-flex items-center gap-1 text-slate-500">
          <MapPin className="h-3.5 w-3.5" aria-hidden="true" /> {c.where}
        </span>
      </div>
      <p className="mb-6 max-w-3xl text-slate-600">{c.intro}</p>

      <div className={`grid gap-8 ${isPhone ? "md:grid-cols-[1fr_15rem]" : "xl:grid-cols-2"}`}>
        <div className="min-w-0">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-500">Steps</h3>
          <ol className="space-y-3">
            {c.steps.map((s, i) => (
              <li key={s} className="flex gap-3 text-slate-700">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-orange-100 text-xs font-bold text-orange-700 print:[print-color-adjust:exact]">
                  {i + 1}
                </span>
                <span>{s}</span>
              </li>
            ))}
          </ol>
          {c.tips && c.tips.length > 0 && (
            <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 print:[break-inside:avoid]">
              <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-amber-900">
                <Lightbulb className="h-4 w-4" aria-hidden="true" /> Good to know
              </p>
              <ul className="list-disc space-y-1.5 pl-5 text-sm text-amber-950">
                {c.tips.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <Screenshot screen={c.image} />
      </div>
    </section>
  );
}

function Screenshot({ screen }: { screen: Screen }) {
  if (screen.width < screen.height) {
    return (
      <figure className="mx-auto w-full max-w-[240px] self-start overflow-hidden rounded-[2rem] border-[6px] border-slate-800 bg-slate-800 shadow-xl print:max-w-[200px]">
        {/* eslint-disable-next-line @next/next/no-img-element -- a static screenshot */}
        <img src={screen.src} alt={screen.alt} width={screen.width} height={screen.height} loading="lazy" className="h-auto w-full rounded-[1.5rem]" />
      </figure>
    );
  }
  return (
    <figure className="self-start overflow-hidden rounded-xl border border-slate-200 bg-slate-100 shadow-md print:[break-inside:avoid]">
      {/* eslint-disable-next-line @next/next/no-img-element -- a static screenshot */}
      <img src={screen.src} alt={screen.alt} width={screen.width} height={screen.height} loading="lazy" className="h-auto w-full" />
    </figure>
  );
}
