import { useState, useEffect, useRef } from "react";

export function useDarkMode(): boolean {
  const mqlRef = useRef(window.matchMedia("(prefers-color-scheme: dark)"));
  const [isDark, setIsDark] = useState(mqlRef.current.matches);

  useEffect(() => {
    const mql = mqlRef.current;
    const handler = (e: MediaQueryListEvent) => setIsDark(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  return isDark;
}
