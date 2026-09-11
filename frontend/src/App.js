import "@/App.css";
import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Routes, Route } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Toaster } from "@/components/ui/sonner";
import {
  PreferencesProvider,
  usePreferences,
} from "@/contexts/PreferencesContext";
import { AuthProvider } from "@/contexts/AuthContext";
import RequireAdmin from "@/components/RequireAdmin";
import RequireErp from "@/components/RequireErp";
import RequireSitePortal from "@/components/RequireSitePortal";
import Layout from "@/components/Layout";

// Every page loads on its own chunk instead of one ~300kB bundle on first
// paint - each import() only runs when its route is actually visited.
const Login = lazy(() => import("@/pages/Login"));
const AdminUsers = lazy(() => import("@/pages/AdminUsers"));
const SitePortalRequest = lazy(() => import("@/pages/SitePortalRequest"));
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const PurchaseDetails = lazy(() => import("@/pages/PurchaseDetails"));
const PurchaseOrders = lazy(() => import("@/pages/PurchaseOrders"));
const PurchaseOrderDetails = lazy(() => import("@/pages/PurchaseOrderDetails"));
const PurchaseOrderReport = lazy(() => import("@/pages/PurchaseOrderReport"));
const PriceHistory = lazy(() => import("@/pages/PriceHistory"));
const Payments = lazy(() => import("@/pages/Payments"));
const Suppliers = lazy(() => import("@/pages/Suppliers"));
const Items = lazy(() => import("@/pages/Items"));
const Projects = lazy(() => import("@/pages/Projects"));
const Customers = lazy(() => import("@/pages/Customers"));
const SettingsPage = lazy(() => import("@/pages/SettingsPage"));
const IncomingPurchaseRequests = lazy(() => import("@/pages/IncomingPurchaseRequests"));
const SupplierPriceComparison = lazy(() => import("@/pages/SupplierPriceComparison"));
const DocumentReview = lazy(() => import("@/pages/DocumentReview"));
const ProjectPurchases = lazy(() => import("@/pages/ProjectPurchases"));
const ApprovalsCommandCenter = lazy(() => import("@/pages/ApprovalsCommandCenter"));
const RfqRegister = lazy(() => import("@/pages/RfqRegister"));
const RfqWorkspace = lazy(() => import("@/pages/RfqWorkspace"));
const DailyProcurementReport = lazy(() => import("@/pages/DailyProcurementReport"));
const PublicApproval = lazy(() => import("@/pages/PublicApproval"));

function RouteFallback() {
  const { language } = usePreferences();
  return (
    <div className="flex min-h-[40vh] items-center justify-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      {language === "en" ? "Loading…" : "جارٍ التحميل…"}
    </div>
  );
}

function AppRoutes() {
  const { direction } = usePreferences();
  return (
    <div className="App" dir={direction}>
      <Toaster position="bottom-left" richColors dir={direction} />
      <BrowserRouter>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route element={<RequireErp><Layout /></RequireErp>}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/purchases/:purchaseId" element={<PurchaseDetails />} />
              <Route path="/purchase-orders" element={<PurchaseOrders />} />
              <Route path="/purchase-orders/:purchaseOrderId" element={<PurchaseOrderDetails />} />
              <Route path="/price-history" element={<PriceHistory />} />
              <Route path="/payments" element={<Payments />} />
              <Route path="/suppliers" element={<Suppliers />} />
              <Route path="/items" element={<Items />} />
              <Route path="/projects" element={<Projects />} />
              <Route path="/projects/:projectId/purchases" element={<ProjectPurchases />} />
              <Route path="/approvals" element={<ApprovalsCommandCenter />} />
              <Route path="/customers" element={<Customers />} />
              <Route
                path="/settings"
                element={<RequireAdmin><SettingsPage /></RequireAdmin>}
              />
              <Route
                path="/admin/users"
                element={<RequireAdmin><AdminUsers /></RequireAdmin>}
              />
              <Route
                path="/incoming-requests"
                element={<IncomingPurchaseRequests />}
              />
              <Route
                path="/incoming-requests/:requestId/documents/:documentId/review"
                element={<DocumentReview />}
              />
              <Route
                path="/supplier-price-comparison"
                element={<SupplierPriceComparison />}
              />
              <Route path="/rfqs" element={<RfqRegister />} />
              <Route path="/rfq/:rfqId" element={<RfqWorkspace />} />
              <Route path="/daily-report" element={<DailyProcurementReport />} />
              <Route
                path="/construction-calculator"
                element={<Navigate to="/" replace />}
              />
            </Route>
            <Route path="/login" element={<Login />} />
            <Route
              path="/request-purchase"
              element={<RequireSitePortal><SitePortalRequest /></RequireSitePortal>}
            />
            <Route path="/approval/:token" element={<PublicApproval />} />
            <Route path="/purchase-orders/:purchaseOrderId/report/:audience" element={<PurchaseOrderReport />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </div>
  );
}

function App() {
  return (
    <PreferencesProvider>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </PreferencesProvider>
  );
}

export default App;
