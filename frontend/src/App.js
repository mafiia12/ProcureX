import "@/App.css";
import { BrowserRouter, Navigate, Routes, Route } from "react-router-dom";
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
import Login from "@/pages/Login";
import AdminUsers from "@/pages/AdminUsers";
import SitePortalRequest from "@/pages/SitePortalRequest";
import Dashboard from "@/pages/Dashboard";
import PurchaseDetails from "@/pages/PurchaseDetails";
import PurchaseOrders from "@/pages/PurchaseOrders";
import PurchaseOrderDetails from "@/pages/PurchaseOrderDetails";
import PurchaseOrderReport from "@/pages/PurchaseOrderReport";
import PriceHistory from "@/pages/PriceHistory";
import Payments from "@/pages/Payments";
import Suppliers from "@/pages/Suppliers";
import Items from "@/pages/Items";
import Projects from "@/pages/Projects";
import Customers from "@/pages/Customers";
import SettingsPage from "@/pages/SettingsPage";
import IncomingPurchaseRequests from "@/pages/IncomingPurchaseRequests";
import SupplierPriceComparison from "@/pages/SupplierPriceComparison";
import DocumentReview from "@/pages/DocumentReview";
import ProjectPurchases from "@/pages/ProjectPurchases";
import ApprovalsCommandCenter from "@/pages/ApprovalsCommandCenter";
import RfqRegister from "@/pages/RfqRegister";
import RfqWorkspace from "@/pages/RfqWorkspace";
import DailyProcurementReport from "@/pages/DailyProcurementReport";
import PublicApproval from "@/pages/PublicApproval";
function AppRoutes() {
  const { direction } = usePreferences();
  return (
    <div className="App" dir={direction}>
      <Toaster position="bottom-left" richColors dir={direction} />
      <BrowserRouter>
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
