"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { getColorStyle, setColorStyle as persistColorStyle, type ColorStyle } from "@/lib/colorStyle";

interface ColorStyleContextValue {
  style: ColorStyle;
  setStyle: (style: ColorStyle) => void;
}

const ColorStyleContext = createContext<ColorStyleContextValue>({
  style: "neutral",
  setStyle: () => undefined,
});

export function ColorStyleProvider({ children }: { children: React.ReactNode }) {
  const [style, setStyleState] = useState<ColorStyle>("neutral");

  useEffect(() => {
    const initial = getColorStyle();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- bridging from localStorage, an external system
    setStyleState(initial);
    document.documentElement.setAttribute("data-style", initial);
  }, []);

  function setStyle(next: ColorStyle) {
    setStyleState(next);
    persistColorStyle(next);
    document.documentElement.setAttribute("data-style", next);
  }

  return <ColorStyleContext.Provider value={{ style, setStyle }}>{children}</ColorStyleContext.Provider>;
}

export function useColorStyle(): ColorStyleContextValue {
  return useContext(ColorStyleContext);
}
