"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, LogIn, Mail, Phone, Printer } from "lucide-react";
import type { Screen, TourSlide } from "@/lib/marketing/productTour";

type Contact = { email: string; phone: string; phoneHref: string };

// The slide number lives in the URL hash (#3), so a link can open the tour at a given slide, and
// Back and Forward don't fill up with one history entry per click.
function slideFromHash(count: number): number {
  if (typeof window === "undefined") return 0;
  const n = Number(window.location.hash.replace("#", ""));
  return Number.isInteger(n) && n >= 1 && n <= count ? n - 1 : 0;
}

// replaceState doesn't fire hashchange, so go() announces the move itself.
const SLIDE_EVENT = "petropro-tour-slide";
function subscribeToSlide(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  window.addEventListener(SLIDE_EVENT, onChange);
  return () => {
    window.removeEventListener("hashchange", onChange);
    window.removeEventListener(SLIDE_EVENT, onChange);
  };
}

export default function TourDeck({ slides, contact }: { slides: TourSlide[]; contact: Contact }) {
  const total = slides.length;
  const index = useSyncExternalStore(subscribeToSlide, () => slideFromHash(total), () => 0);
  const touchStartX = useRef<number | null>(null);

  const go = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(total - 1, next));
      window.history.replaceState(null, "", `#${clamped + 1}`);
      window.dispatchEvent(new Event(SLIDE_EVENT));
    },
    [total],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") {
        e.preventDefault();
        go(index + 1);
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        go(index - 1);
      } else if (e.key === "Home") {
        go(0);
      } else if (e.key === "End") {
        go(total - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, index, total]);

  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0]?.clientX ?? null;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current == null) return;
    const dx = (e.changedTouches[0]?.clientX ?? touchStartX.current) - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(dx) > 50) go(index + (dx < 0 ? 1 : -1));
  };

  const isLast = index === total - 1;

  return (
    <main className="bg-slate-50 print:bg-white">
      {/* Toolbar */}
      <div className="border-b border-slate-200 bg-white print:hidden">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-orange-600">Product Tour</p>
            <p className="text-sm text-slate-500">Use the arrow keys or swipe to move between slides.</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <Printer className="h-4 w-4" aria-hidden="true" /> Save as PDF
            </button>
            <a
              href="#contact-us"
              onClick={(e) => {
                e.preventDefault();
                go(total - 1);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-orange-500 px-3 py-2 text-sm font-medium text-white hover:bg-orange-600"
            >
              Book a demo
            </a>
          </div>
        </div>
        <div className="h-1 bg-slate-100" aria-hidden="true">
          <div className="h-1 bg-orange-500 transition-all duration-300" style={{ width: `${((index + 1) / total) * 100}%` }} />
        </div>
      </div>

      <section
        className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10 print:max-w-none print:p-0"
        aria-roledescription="carousel"
        aria-label="PetroPro product tour"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <p className="sr-only" aria-live="polite">
          Slide {index + 1} of {total}
        </p>
        {slides.map((slide, i) => (
          <article
            key={i}
            aria-roledescription="slide"
            aria-label={`${i + 1} of ${total}`}
            aria-hidden={i !== index}
            className={`${i === index ? "block" : "hidden"} print:block print:break-after-page print:[break-inside:avoid]`}
          >
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm lg:min-h-[560px] print:rounded-none print:border-0 print:shadow-none">
              <SlideBody slide={slide} contact={contact} />
            </div>
            <p className="mt-2 hidden text-right text-xs text-slate-400 print:block">
              PetroPro Product Tour · {i + 1} / {total}
            </p>
          </article>
        ))}

        <nav className="mt-6 flex items-center justify-between gap-4 print:hidden" aria-label="Tour navigation">
          <button
            type="button"
            onClick={() => go(index - 1)}
            disabled={index === 0}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Previous
          </button>

          <div className="hidden items-center gap-1.5 sm:flex" role="tablist" aria-label="Choose a slide">
            {slides.map((s, i) => (
              <button
                key={i}
                type="button"
                role="tab"
                aria-selected={i === index}
                aria-label={`Slide ${i + 1}: ${s.title}`}
                title={s.eyebrow}
                onClick={() => go(i)}
                className={`h-2.5 rounded-full transition-all ${i === index ? "w-6 bg-orange-500" : "w-2.5 bg-slate-300 hover:bg-slate-400"}`}
              />
            ))}
          </div>
          <span className="text-sm tabular-nums text-slate-500 sm:hidden">
            {index + 1} / {total}
          </span>

          {isLast ? (
            <Link href="/" className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
              Back to home
            </Link>
          ) : (
            <button
              type="button"
              onClick={() => go(index + 1)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-orange-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-orange-600"
            >
              Next <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </nav>
      </section>
    </main>
  );
}

/** A desktop screen in a browser frame, or a phone screen in a phone frame. */
function Screenshot({ screen }: { screen: Screen }) {
  if (screen.width < screen.height) {
    return (
      <figure className="mx-auto w-full max-w-[260px] overflow-hidden rounded-[2rem] border-[6px] border-slate-800 bg-slate-800 shadow-xl">
        {/* eslint-disable-next-line @next/next/no-img-element -- a static screenshot */}
        <img src={screen.src} alt={screen.alt} width={screen.width} height={screen.height} className="h-auto w-full rounded-[1.5rem]" />
      </figure>
    );
  }
  const visible = Math.round(screen.height * (screen.cropTop ?? 1));
  return (
    <figure className="overflow-hidden rounded-xl border border-slate-200 bg-slate-100 shadow-lg">
      <div className="flex items-center gap-1.5 border-b border-slate-200 bg-slate-200/70 px-3 py-2" aria-hidden="true">
        <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
        <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
        <span className="h-2.5 w-2.5 rounded-full bg-green-400" />
      </div>
      <div className="relative w-full overflow-hidden" style={{ aspectRatio: `${screen.width} / ${visible}` }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- a static screenshot */}
        <img src={screen.src} alt={screen.alt} width={screen.width} height={screen.height} className="absolute inset-x-0 top-0 h-auto w-full" />
      </div>
    </figure>
  );
}

function SlideBody({ slide, contact }: { slide: TourSlide; contact: Contact }) {
  switch (slide.kind) {
    case "cover":
      return (
        <div className="grid items-center gap-8 bg-gradient-to-br from-slate-950 via-slate-900 to-blue-950 p-6 text-white sm:p-10 lg:min-h-[560px] lg:grid-cols-2 lg:p-12 print:[print-color-adjust:exact]">
          <div>
            <p className="mb-4 text-sm font-semibold uppercase tracking-wider text-orange-300">{slide.eyebrow}</p>
            <h1 className="mb-5 font-heading text-3xl font-bold leading-tight sm:text-4xl">{slide.title}</h1>
            <p className="text-lg text-slate-300">{slide.subtitle}</p>
          </div>
          <Screenshot screen={slide.image} />
        </div>
      );
    case "points":
      return (
        <div className="p-6 sm:p-10 lg:p-12">
          <Eyebrow text={slide.eyebrow} />
          <h2 className="mb-3 font-heading text-2xl font-bold sm:text-3xl">{slide.title}</h2>
          {slide.intro && <p className="mb-8 max-w-3xl text-slate-600">{slide.intro}</p>}
          <div className={`grid gap-4 sm:grid-cols-2 sm:gap-5 ${slide.points.length > 4 ? "lg:grid-cols-3" : ""} ${slide.intro ? "" : "mt-8"}`}>
            {slide.points.map((p, i) => (
              <div key={p.title} className="rounded-xl border border-slate-200 bg-slate-50 p-5">
                <p className="mb-1 text-sm font-semibold tabular-nums text-orange-600">0{i + 1}</p>
                <h3 className="mb-1.5 font-semibold">{p.title}</h3>
                <p className="text-sm text-slate-600">{p.text}</p>
              </div>
            ))}
          </div>
        </div>
      );
    case "flow":
      return (
        <div className="p-6 sm:p-10 lg:p-12">
          <Eyebrow text={slide.eyebrow} />
          <h2 className="mb-3 font-heading text-2xl font-bold sm:text-3xl">{slide.title}</h2>
          <p className="mb-8 max-w-3xl text-slate-600">{slide.intro}</p>
          <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {slide.steps.map((s, i) => (
              <li key={s.title} className="relative rounded-xl border-2 border-orange-100 bg-orange-50/50 p-5">
                <span className="mb-3 inline-flex h-8 w-8 items-center justify-center rounded-full bg-orange-500 text-sm font-bold text-white print:[print-color-adjust:exact]">
                  {i + 1}
                </span>
                <h3 className="mb-1.5 font-semibold">{s.title}</h3>
                <p className="text-sm text-slate-600">{s.text}</p>
                {i < slide.steps.length - 1 && (
                  <ArrowRight className="absolute -right-4 top-1/2 z-10 hidden h-6 w-6 -translate-y-1/2 rounded-full bg-white text-orange-300 lg:block" aria-hidden="true" />
                )}
              </li>
            ))}
          </ol>
          <p className="mt-8 rounded-xl border border-green-200 bg-green-50 px-5 py-4 text-sm text-green-900 sm:text-base">
            <Check className="-mt-0.5 mr-1.5 inline h-4 w-4" aria-hidden="true" />
            {slide.footnote}
          </p>
        </div>
      );
    case "feature": {
      const isPhone = slide.image.width < slide.image.height;
      return (
        <div className="grid items-center gap-8 p-6 sm:p-10 lg:grid-cols-5 lg:p-12">
          <div className={isPhone ? "lg:col-span-3" : "lg:col-span-2"}>
            <Eyebrow text={slide.eyebrow} />
            <h2 className="mb-3 font-heading text-2xl font-bold leading-tight sm:text-3xl">{slide.title}</h2>
            <p className="mb-5 text-slate-600">{slide.intro}</p>
            <ul className="space-y-2.5">
              {slide.bullets.map((b) => (
                <li key={b} className="flex gap-2.5 text-sm text-slate-700">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-600" aria-hidden="true" />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className={isPhone ? "lg:col-span-2" : "lg:col-span-3"}>
            <Screenshot screen={slide.image} />
          </div>
        </div>
      );
    }
    case "contact":
      return (
        <div className="grid items-center gap-8 p-6 sm:p-10 lg:min-h-[560px] lg:grid-cols-2 lg:p-12">
          <div>
            <Eyebrow text={slide.eyebrow} />
            <h2 className="mb-3 font-heading text-2xl font-bold leading-tight sm:text-3xl">{slide.title}</h2>
            <p className="mb-6 text-slate-600">{slide.intro}</p>
            <ul className="space-y-2.5">
              {slide.offers.map((o) => (
                <li key={o} className="flex gap-2.5 text-slate-700">
                  <Check className="h-5 w-5 shrink-0 text-green-600" aria-hidden="true" />
                  <span>{o}</span>
                </li>
              ))}
            </ul>
          </div>
          <div id="contact-us" className="space-y-5 rounded-2xl bg-gradient-to-br from-slate-950 via-slate-900 to-blue-950 p-6 text-white sm:p-8 print:[print-color-adjust:exact]">
            <p className="text-lg font-semibold">Book your demo</p>
            <a
              href={`mailto:${contact.email}?subject=${encodeURIComponent("PetroPro demo")}`}
              className="flex items-center gap-3 break-all rounded-xl bg-white/10 px-4 py-3 transition-colors hover:bg-white/20"
            >
              <Mail className="h-5 w-5 shrink-0 text-orange-300" aria-hidden="true" /> {contact.email}
            </a>
            <a href={contact.phoneHref} className="flex items-center gap-3 rounded-xl bg-white/10 px-4 py-3 transition-colors hover:bg-white/20">
              <Phone className="h-5 w-5 shrink-0 text-orange-300" aria-hidden="true" /> {contact.phone}
            </a>
            <Link href="/login" className="flex items-center gap-3 rounded-xl border border-white/30 px-4 py-3 text-slate-200 transition-colors hover:bg-white/10 print:hidden">
              <LogIn className="h-5 w-5 shrink-0" aria-hidden="true" /> Already a customer? Sign in
            </Link>
          </div>
        </div>
      );
  }
}

function Eyebrow({ text }: { text: string }) {
  return <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-orange-600">{text}</p>;
}
