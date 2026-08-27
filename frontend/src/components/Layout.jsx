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
  CalendarDays,
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
  admin: ["مدير النظام", "System Administrator"],
  procurement_responsible: ["مسؤول المشتريات", "Procurement Lead"],
  procurement_engineer: ["مهندس المشتريات", "Procurement Engineer"],
  commercial_manager: ["المدير التجاري", "Commercial Manager"],
};

const NAV_GROUPS = [
  { key: "operations", label: ["التشغيل", "Operations"], items: [
  { to: "/", key: "dashboard", icon: LayoutDashboard },
  { to: "/daily-report", key: "dailyReport", icon: CalendarDays },
  { to: "/incoming-requests", key: "incoming", icon: Inbox },
  { to: "/supplier-price-comparison", key: "comparison", icon: Scale },
  { to: "/approvals", key: "approvals", icon: FileCheck2 },
  { to: "/purchase-orders", key: "purchaseOrders", icon: ShoppingCart },
  { to: "/payments", key: "payments", icon: Wallet },
  ] },
  { key: "masterData", label: ["البيانات الأساسية", "Master Data"], items: [
  { to: "/suppliers", key: "suppliers", icon: Truck },
  { to: "/items", key: "items", icon: Package },
  { to: "/projects", key: "projects", icon: FolderKanban },
  ] },
  { key: "administration", label: ["الإدارة", "Administration"], items: [
  { to: "/admin/users", key: "adminUsers", icon: UserCog, adminOnly: true },
  { to: "/settings", key: "settings", icon: Settings, adminOnly: true },
  ] },
];

const LEGACY_NAV = [
  { to: "/purchases", key: "purchases", icon: ShoppingCart, hidden: true },
  { to: "/register", key: "register", icon: BookOpenText, hidden: true },
  { to: "/price-history", key: "history", icon: LineChart, hidden: true },
  { to: "/customers", key: "customers", icon: Users, hidden: true },
  { to: "/approved-items-draft", key: "approvedDraft", icon: BookOpenText, hidden: true },
];

const NAV = [...NAV_GROUPS.flatMap((group) => group.items), ...LEGACY_NAV];

export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const preferences = usePreferences();
  const t = preferences.t;
  const tr = preferences.tr || ((arabic) => arabic);
  const direction = preferences.direction || "rtl";
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
  const visibleGroups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.adminOnly || isAdmin),
  })).filter((group) => group.items.length);
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
          className={`flex items-center border-b py-4 ${
            sidebarCollapsed ? "justify-center px-2" : "gap-3 px-4"
          }`}
        >
          <div className="h-9 w-9 bg-primary flex items-center justify-center">
            <Building2 className="h-5 w-5 text-white" />
          </div>
          {!sidebarCollapsed && <div>
            <div
              className="text-sm font-bold leading-tight text-foreground"
              style={{ fontFamily: "Cairo" }}
            >
              RE DECOR & MORE
            </div>
            <div className="text-[11px] text-muted-foreground">{t("appName")}</div>
          </div>}
        </div>
        {isErpUser && (
          <div
            className={`${sidebarCollapsed ? "px-2" : "px-4"} border-b py-3`}
            data-testid="sidebar-user"
          >
            <div className={`flex items-center min-w-0 ${sidebarCollapsed ? "justify-center" : "gap-2"}`}>
              <div className="flex h-8 w-8 shrink-0 items-center justify-center border bg-muted">
                <UserRound className="h-4 w-4 text-muted-foreground" />
              </div>
              {!sidebarCollapsed && <div className="min-w-0">
                <div className="truncate text-sm font-bold text-foreground" data-testid="sidebar-user-name">
                  {user.display_name || user.username}
                </div>
                <div className="truncate text-xs text-muted-foreground" data-testid="sidebar-user-role">
                  {ROLE_LABELS[user.role] ? tr(...ROLE_LABELS[user.role]) : user.role}
                </div>
              </div>}
            </div>
            <button
              type="button"
              onClick={handleLogout}
              data-testid="sidebar-logout"
              title={sidebarCollapsed ? tr("تسجيل الخروج", "Sign out") : undefined}
              aria-label={tr("تسجيل الخروج", "Sign out")}
              className={`mt-2 flex w-full items-center justify-center rounded-md border py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:border-destructive/30 hover:bg-destructive/10 hover:text-destructive ${
                sidebarCollapsed ? "px-1" : "gap-1.5"
              }`}
            >
              <LogOut className="h-3.5 w-3.5" />
              {!sidebarCollapsed && tr("تسجيل الخروج", "Sign out")}
            </button>
          </div>
        )}
        <nav className="flex-1 overflow-y-auto px-2 py-2 scrollbar-thin">
          {visibleGroups.map((group, groupIndex) => <div key={group.key} className={groupIndex ? "mt-3" : ""}>
            {!sidebarCollapsed && <div className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{tr(...group.label)}</div>}
            <div className="space-y-0.5">{group.items.map(({ to, key, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              data-testid={`nav-${to === "/" ? "dashboard" : to.slice(1)}`}
              title={sidebarCollapsed ? t(`nav.${key}`) : undefined}
              aria-label={t(`nav.${key}`)}
              className={({ isActive }) =>
                `flex items-center py-1.5 text-sm transition-colors duration-200 ${
                  sidebarCollapsed ? "justify-center px-2" : "gap-3 px-3"
                } ${
                  isActive
                    ? "bg-primary text-primary-foreground font-bold"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`
              }
            >
              <Icon className="h-4 w-4 shrink-0" />
              {!sidebarCollapsed && t(`nav.${key}`)}
            </NavLink>
          ))}</div></div>)}
        </nav>
        {!sidebarCollapsed && (
          <div className="border-t px-4 py-2.5 text-[11px] text-muted-foreground">
            © RE DECOR & MORE
          </div>
        )}
      </aside>
      <div
        className={`flex-1 flex flex-col min-w-0 transition-[margin] duration-300 ${
          sidebarCollapsed ? "ms-16" : "ms-60"
        }`}
      >
        <header className="sticky top-0 z-20 flex items-center justify-between border-b bg-card/95 px-4 py-2.5 backdrop-blur md:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={toggleSidebar}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
              className="truncate text-base font-bold text-foreground"
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
        <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-4 md:px-5 md:py-5">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
