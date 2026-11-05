export type Design = "classic" | "modern";

export const DESIGNS: { value: Design; label: string; hint: string }[] = [
  { value: "classic", label: "Classic Design", hint: "Navy, cream and gold, traditional styling" },
  { value: "modern", label: "Modern Design", hint: "Blue, purple and white, soft gradients" },
];

/** Also read by the pre-paint script in app/layout.tsx, so a saved design shows without a flash. */
const STORAGE_KEY = "petropro.design";
const LIGHT_DARK_KEY = "petropro.theme";

function save(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage can be blocked. The design still applies until the page reloads.
  }
}

export function currentDesign(): Design | null {
  const value = document.documentElement.getAttribute("data-design");
  return DESIGNS.some((d) => d.value === value) ? (value as Design) : null;
}

/** Both designs are drawn on light backgrounds, so the first choice opens in light. After that the
 *  person's light/dark setting is kept, including for customers, who have no light/dark button. */
export function applyDesign(design: Design) {
  const root = document.documentElement;
  if (currentDesign() === null) {
    root.classList.add("light");
    save(LIGHT_DARK_KEY, "light");
  }
  root.setAttribute("data-design", design);
  save(STORAGE_KEY, design);
}
