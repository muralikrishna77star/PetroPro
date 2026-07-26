export type ColorStyle = "neutral" | "tinted" | "header-bars" | "vibrant-sidebar" | "bold";

export const COLOR_STYLES: { value: ColorStyle; label: string; hint: string }[] = [
  { value: "neutral", label: "Neutral", hint: "Thin colored border, white cards (today's look)" },
  { value: "tinted", label: "Tinted cards", hint: "Soft category-color background on every card" },
  { value: "header-bars", label: "Header bars", hint: "Solid color bar across the top of each card" },
  { value: "vibrant-sidebar", label: "Vibrant sidebar", hint: "Bold color in the sidebar; cards stay neutral" },
  { value: "bold", label: "Bold everywhere", hint: "Tinted cards + vibrant sidebar + richer status colors" },
];

const STORAGE_KEY = "petropro.colorStyle";
const DEFAULT_STYLE: ColorStyle = "neutral";

export function getColorStyle(): ColorStyle {
  if (typeof window === "undefined") return DEFAULT_STYLE;
  const raw = localStorage.getItem(STORAGE_KEY);
  return COLOR_STYLES.some((s) => s.value === raw) ? (raw as ColorStyle) : DEFAULT_STYLE;
}

export function setColorStyle(style: ColorStyle): void {
  localStorage.setItem(STORAGE_KEY, style);
}
