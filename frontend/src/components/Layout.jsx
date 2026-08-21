import { useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  ShoppingCart,
  BookOpenText,
  LineChart,
  Wallet,
  Truck,
  Package,
  FolderKanban,
  Users,
  UserCog,
  Settings,
  Building2,
  Inbox,
  Scale,
  FileCheck2,
  UserRound,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import PreferenceControls from "@/components/PreferenceControls";
import { usePreferences } from "@/contexts/PreferencesContext";
import { useAuth } from "@/contexts/AuthContext";

const SIDEBAR_STORAGE_KEY = "procurex-sidebar-collapsed";

// Fixed ERP roles only (see backend auth/models.py ERP_ROLES) - an unknown
// value falls back to the raw role string rather than a blank label.
const ROLE_LABELS = {
  admin: "مدير النظام",
  procurement_responsible: "مسؤول المشتريات",
  procurement_engineer: "مهندس المشتريات",
  commercial_manager: "المدير التجاري",
};

const NAV = [
  { to: "/", key: "dashboard", icon: LayoutDashboard },
  { to: "/incoming-requests", key: "incoming", icon: Inbox },
  { to: "/supplier-price-comparison", key: "comparison", icon: Scale },
  { to: "/approvals", key: "approvals", icon: FileCheck2 },
  { to: "/purchase-orders", key: "purchaseOrders", icon: ShoppingCart },
  { to: "/payments", key: "payments", icon: Wallet },
  { to: "/suppliers", key: "suppliers", icon: Truck },
  { to: "/items", key: "items", icon: Package },
  { to: "/projects", key: "projects", icon: FolderKanban },
  { to: "/purchases", key: "purchases", icon: ShoppingCart, hidden: true },
  { to: "/register", key: "register", icon: BookOpenText, hidden: true },
  { to: "/price-history", key: "history", icon: LineChart, hidden: true },
  { to: "/customers", key: "customers", icon: Users, hidden: true },
  { to: "/approved-items-draft", key: "approvedDraft", icon: BookOpenText, hidden: true },
  { to: "/admin/users", key: "adminUsers", icon: UserCog, adminOnly: true },
  { to: "/settings", key: "settings", icon: Settings, adminOnly: true },
];

export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { t, direction } = usePreferences();
  const { user, logout } = useAuth();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem(SIDEBAR_STORAGE_KEY) === "true",
  );
  const isErpUser = user?.account_type === "erp";
  const isAdmin = isErpUser && user?.role === "admin";
  const handleLogout = () => {
    logout?.();
    navigate("/login", { replace: true });
  };
  const toggleSidebar = () => {
    setSidebarCollapsed((collapsed) => {
      const nextValue = !collapsed;
      localStorage.setItem(SIDEBAR_STORAGE_KEY, String(nextValue));
      return nextValue;
    });
  };
  const visibleNav = NAV.filter((item) => !item.hidden && (!item.adminOnly || isAdmin));
  const current =
    NAV.find((n) => n.to === location.pathname) ||
    (location.pathname.startsWith("/purchases/")
      ? NAV.find((n) => n.key === "purchases")
      : null) ||
    (location.pathname.startsWith("/purchase-orders/")
      ? NAV.find((n) => n.key === "purchaseOrders")
      : null) ||
    (location.pathname.startsWith("/projects/")
      ? NAV.find((n) => n.key === "projects")
      : null) ||
    (location.pathname.includes("/documents/")
      ? NAV.find((n) => n.key === "incoming")
      : null);
  return (
    <div className="flex min-h-screen bg-background">
      <aside
        id="main-sidebar"
        className={`shrink-0 border-e bg-card flex flex-col fixed inset-y-0 start-0 z-30 overflow-hidden transition-[width] duration-300 ${
          sidebarCollapsed ? "w-16" : "w-60"
        }`}
        data-testid="sidebar"
        data-collapsed={sidebarCollapsed}
      >
        <div
          className={`py-5 border-b border-slate-200 flex items-center ${
            sidebarCollapsed ? "justify-center px-2" : "gap-3 px-4"
          }`}
        >
          <div className="h-10 w-10 rounded-md bg-primary flex items-center justify-center">
            <Building2 className="h-5 w-5 text-white" />
          </div>
          {!sidebarCollapsed && <div>
            <div
              className="font-bold text-sm text-slate-900 leading-tight"
              style={{ fontFamily: "Cairo" }}
            >
              RE DECOR & MORE
            </div>
            <div className="text-xs text-muted-foreground">{t("appName")}</div>
          </div>}
        </div>
        {isErpUser && (
          <div
            className={`${sidebarCollapsed ? "px-2" : "px-4"} py-3 border-b border-slate-200`}
            data-testid="sidebar-user"
          >
            <div className={`flex items-center min-w-0 ${sidebarCollapsed ? "justify-center" : "gap-2"}`}>
              <div className="h-8 w-8 shrink-0 rounded-full bg-slate-100 flex items-center justify-center">
                <UserRound className="h-4 w-4 text-slate-500" />
              </div>
              {!sidebarCollapsed && <div className="min-w-0">
                <div className="truncate text-sm font-bold text-slate-900" data-testid="sidebar-user-name">
                  {user.display_name || user.username}
                </div>
                <div className="truncate text-xs text-slate-500" data-testid="sidebar-user-role">
                  {ROLE_LABELS[user.role] || user.role}
                </div>
              </div>}
            </div>
            <button
              type="button"
              onClick={handleLogout}
              data-testid="sidebar-logout"
              title={sidebarCollapsed ? "تسجيل الخروج" : undefined}
              aria-label="تسجيل الخروج"
              className={`mt-2 flex w-full items-center justify-center rounded-md border border-slate-200 py-1.5 text-xs font-bold text-slate-600 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600 ${
                sidebarCollapsed ? "px-1" : "gap-1.5"
              }`}
            >
              <LogOut className="h-3.5 w-3.5" />
              {!sidebarCollapsed && "تسجيل الخروج"}
            </button>
          </div>
        )}
        <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto scrollbar-thin">
          {visibleNav.map(({ to, key, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              data-testid={`nav-${to === "/" ? "dashboard" : to.slice(1)}`}
              title={sidebarCollapsed ? t(`nav.${key}`) : undefined}
              aria-label={t(`nav.${key}`)}
              className={({ isActive }) =>
                `flex items-center rounded-md py-2 text-sm transition-colors duration-200 ${
                  sidebarCollapsed ? "justify-center px-2" : "gap-3 px-3"
                } ${
                  isActive
                    ? "bg-primary/10 text-primary font-semibold ring-1 ring-inset ring-primary/15"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"
                }`
              }
            >
              <Icon className="h-4 w-4 shrink-0" />
              {!sidebarCollapsed && t(`nav.${key}`)}
            </NavLink>
          ))}
        </nav>
        {!sidebarCollapsed && (
          <div className="px-4 py-3 border-t border-slate-200 text-xs text-slate-400">
            © RE DECOR & MORE
          </div>
        )}
      </aside>
      <div
        className={`flex-1 flex flex-col min-w-0 transition-[margin] duration-300 ${
          sidebarCollapsed ? "ms-16" : "ms-60"
        }`}
      >
        <header className="sticky top-0 z-20 bg-card border-b px-6 py-3 flex items-center justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={toggleSidebar}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-slate-200 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
              aria-controls="main-sidebar"
              aria-expanded={!sidebarCollapsed}
              aria-label={sidebarCollapsed ? t("expandMenu") : t("collapseMenu")}
              title={sidebarCollapsed ? t("expandMenu") : t("collapseMenu")}
              data-testid="sidebar-toggle"
            >
              {direction === "rtl" ? (
                sidebarCollapsed ? <PanelRightOpen className="h-4 w-4" /> : <PanelRightClose className="h-4 w-4" />
              ) : sidebarCollapsed ? (
                <PanelLeftOpen className="h-4 w-4" />
              ) : (
                <PanelLeftClose className="h-4 w-4" />
              )}
            </button>
            <h1
              className="truncate text-lg font-bold text-slate-900"
              data-testid="page-title"
            >
              {current ? t(`nav.${current.key}`) : ""}
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden text-xs text-muted-foreground md:block">
              {t("currency")}
            </div>
            <PreferenceControls compact />
          </div>
        </header>
        <main className="flex-1 px-6 py-6 max-w-[1600px] w-full mx-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
