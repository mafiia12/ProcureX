import { useEffect } from "react";

export default function useUnsavedChanges(isDirty, message) {
  useEffect(() => {
    if (!isDirty) return undefined;

    const beforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const interceptLink = (event) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target.closest?.("a[href]");
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const destination = new URL(anchor.href, window.location.href);
      if (destination.origin !== window.location.origin || destination.href === window.location.href) return;
      if (!window.confirm(message)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const interceptHistory = () => {
      if (!window.confirm(message)) window.history.go(1);
    };

    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", interceptLink, true);
    window.addEventListener("popstate", interceptHistory);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", interceptLink, true);
      window.removeEventListener("popstate", interceptHistory);
    };
  }, [isDirty, message]);
}
