import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { ThemeProvider, useTheme } from "next-themes";
import { messages } from "@/i18n/messages";

const fallbackLanguage = () =>
  typeof document !== "undefined" && document.documentElement.lang === "en" ? "en" : "ar";

const lookup = (catalog, key) =>
  key.split(".").reduce((value, part) => value?.[part], catalog);

const translate = (language, key) => {
  const value = lookup(messages[language], key);
  if (value === undefined && process.env.NODE_ENV === "development") {
    console.warn(`[i18n] Missing ${language} translation: ${key}`);
  }
  return value ?? key;
};

const defaultLanguageValue = {
  language: fallbackLanguage(),
  direction: fallbackLanguage() === "en" ? "ltr" : "rtl",
  locale: fallbackLanguage() === "en" ? "en-EG" : "ar-EG",
  setLanguage: () => {},
  t: (key) => translate(fallbackLanguage(), key),
  tr: (arabic, english) => (fallbackLanguage() === "en" ? english : arabic),
};

const LanguageContext = createContext(defaultLanguageValue);

function LanguageProvider({ children }) {
  const [language, setLanguageState] = useState(
    () => localStorage.getItem("procurex-language") || "ar",
  );
  const setLanguage = (value) => {
    const nextLanguage = value === "en" ? "en" : "ar";
    const nextDirection = nextLanguage === "ar" ? "rtl" : "ltr";
    // Keep non-React formatters in sync during the same render that switches
    // the interface language, instead of waiting for the effect below.
    localStorage.setItem("procurex-language", nextLanguage);
    document.documentElement.lang = nextLanguage;
    document.documentElement.dir = nextDirection;
    setLanguageState(nextLanguage);
  };
  useEffect(() => {
    const direction = language === "ar" ? "rtl" : "ltr";
    localStorage.setItem("procurex-language", language);
    document.documentElement.lang = language;
    document.documentElement.dir = direction;
  }, [language]);
  const value = useMemo(
    () => ({
      language,
      direction: language === "ar" ? "rtl" : "ltr",
      locale: language === "ar" ? "ar-EG" : "en-EG",
      setLanguage,
      t: (key) => translate(language, key),
      tr: (arabic, english) => (language === "en" ? english : arabic),
    }),
    [language],
  );
  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

export function PreferencesProvider({ children }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      storageKey="procurex-theme"
    >
      <LanguageProvider>{children}</LanguageProvider>
    </ThemeProvider>
  );
}

export const usePreferences = () => {
  return useContext(LanguageContext);
};

export const useThemePreference = useTheme;
