import { Languages, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  usePreferences,
  useThemePreference,
} from "@/contexts/PreferencesContext";

export default function PreferenceControls({ compact = false }) {
  const { language, setLanguage, t } = usePreferences();
  const { theme, setTheme } = useThemePreference();
  const nextTheme =
    theme === "light" ? "dark" : theme === "dark" ? "system" : "light";
  return (
    <div className="flex items-center gap-1" data-testid="preference-controls">
      <Button
        type="button"
        variant="ghost"
        size={compact ? "icon" : "sm"}
        onClick={() => setLanguage(language === "ar" ? "en" : "ar")}
        title={t("language")}
        aria-label={t("language")}
      >
        <Languages className="h-4 w-4" />
        {!compact && (
          <span className="ms-2">{language === "ar" ? "EN" : "ع"}</span>
        )}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size={compact ? "icon" : "sm"}
        onClick={() => setTheme(nextTheme)}
        title={`${t("theme")}: ${t(theme || "system")}`}
        aria-label={t("theme")}
      >
        {theme === "dark" ? (
          <Moon className="h-4 w-4" />
        ) : (
          <Sun className="h-4 w-4" />
        )}
        {!compact && <span className="ms-2">{t(theme || "system")}</span>}
      </Button>
    </div>
  );
}
