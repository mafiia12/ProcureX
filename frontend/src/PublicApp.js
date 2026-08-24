import "@/App.css";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import PublicPurchaseRequest from "@/pages/PublicPurchaseRequest";
import {
  PreferencesProvider,
  usePreferences,
} from "@/contexts/PreferencesContext";

function PublicRoutes() {
  const { direction } = usePreferences();
  return (
    <div className="App" dir={direction}>
      <Toaster position="bottom-left" richColors dir={direction} />
      <BrowserRouter>
        <Routes>
          <Route path="/request-purchase" element={<PublicPurchaseRequest />} />
          <Route
            path="*"
            element={<Navigate to="/request-purchase" replace />}
          />
        </Routes>
      </BrowserRouter>
    </div>
  );
}

export default function PublicApp() {
  return (
    <PreferencesProvider>
      <PublicRoutes />
    </PreferencesProvider>
  );
}
