import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, KeyRound, X } from "lucide-react";
import api, { errMsg } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { EmptyState, PageHeader, StatusBadge } from "@/components/procurement-ui";
import { usePreferences } from "@/contexts/PreferencesContext";

const ERP_ROLE_OPTIONS = [
  { value: "admin", label: "مسؤول النظام", labelEn: "System Administrator" },
  { value: "procurement_responsible", label: "مسؤول المشتريات", labelEn: "Procurement Lead" },
  { value: "procurement_engineer", label: "مهندس مشتريات", labelEn: "Procurement Engineer" },
  { value: "commercial_manager", label: "المدير التجاري", labelEn: "Commercial Manager" },
];

const emptyCreateForm = {
  display_name: "", username: "", password: "", account_type: "erp",
  role: "admin", project_ids: [], phone: "",
};

export default function AdminUsers() {
  const preferences = usePreferences();
  const language = preferences.language || "ar";
  const tr = preferences.tr || ((ar, en) => (language === "en" ? en : ar));
  const direction = preferences.direction || (language === "en" ? "ltr" : "rtl");
  const roleLabel = (role) => {
    if (role === "site_engineer") return tr("مهندس موقع", "Site Engineer");
    const option = ERP_ROLE_OPTIONS.find((item) => item.value === role);
    return option ? tr(option.label, option.labelEn) : role;
  };
  const [users, setUsers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState(emptyCreateForm);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [resetTarget, setResetTarget] = useState(null);
  const [resetPassword, setResetPassword] = useState("");

  const load = () => {
    api.get("/admin/users").then(({ data }) => setUsers(data)).catch((e) => toast.error(errMsg(e)));
  };
  useEffect(() => {
    load();
    api.get("/projects").then(({ data }) => setProjects(data)).catch(() => setProjects([]));
  }, []);

  const openCreate = () => {
    setCreateForm(emptyCreateForm);
    setCreateOpen(true);
  };

  const createUser = async () => {
    if (!createForm.username.trim() || !createForm.display_name.trim() || !createForm.password) {
      toast.error(tr("يرجى إدخال جميع الحقول المطلوبة", "Complete all required fields"));
      return;
    }
    setSaving(true);
    try {
      const payload = {
        username: createForm.username.trim(),
        display_name: createForm.display_name.trim(),
        password: createForm.password,
        account_type: createForm.account_type,
        active: true,
      };
      if (createForm.account_type === "erp") {
        payload.role = createForm.role;
      } else {
        payload.project_ids = createForm.project_ids;
        payload.phone = createForm.phone.trim();
      }
      await api.post("/admin/users", payload);
      toast.success(tr("تم إنشاء الحساب بنجاح", "Account created successfully"));
      setCreateOpen(false);
      load();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (row) => {
    setEditing(row);
    setEditForm({ display_name: row.display_name, username: row.username, role: row.role, active: row.active, phone: row.phone || "" });
  };

  const saveEdit = async () => {
    try {
      const payload = { display_name: editForm.display_name, username: editForm.username, active: editForm.active };
      if (editing.account_type === "erp") payload.role = editForm.role;
      else payload.phone = (editForm.phone || "").trim();
      await api.put(`/admin/users/${editing.id}`, payload);
      toast.success(tr("تم تحديث الحساب", "Account updated"));
      setEditing(null);
      load();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const toggleActive = async (row) => {
    try {
      await api.put(`/admin/users/${row.id}`, { active: !row.active });
      toast.success(row.active ? tr("تم إيقاف الحساب", "Account disabled") : tr("تم تفعيل الحساب", "Account activated"));
      load();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const submitResetPassword = async () => {
    if (!resetPassword) {
      toast.error(tr("أدخل كلمة مرور جديدة", "Enter a new password"));
      return;
    }
    try {
      await api.post(`/admin/users/${resetTarget.id}/reset-password`, { new_password: resetPassword });
      toast.success(tr("تم تعيين كلمة مرور جديدة", "New password set"));
      setResetTarget(null);
      setResetPassword("");
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const assignProject = async (userId, projectId) => {
    if (!projectId) return;
    try {
      const { data } = await api.post(`/admin/users/${userId}/projects`, { project_id: projectId });
      setUsers((current) => current.map((u) => (u.id === userId ? data : u)));
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const removeProject = async (userId, projectId) => {
    try {
      const { data } = await api.delete(`/admin/users/${userId}/projects/${projectId}`);
      setUsers((current) => current.map((u) => (u.id === userId ? data : u)));
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <div className="space-y-4" data-testid="admin-users-page" dir={direction}>
      <PageHeader title={tr("إدارة المستخدمين", "User Management")} description={tr("إدارة حسابات النظام وبوابة مهندسي الموقع دون تغيير صلاحيات سير العمل.", "Manage internal and site-portal accounts without changing workflow authorization.")} actions={<Button data-testid="admin-users-add-button" onClick={openCreate} className="gap-2"><Plus className="h-4 w-4" /> {tr("إضافة مستخدم", "Add User")}</Button>} />

      <div className="overflow-x-auto rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/90">
              {[tr("الاسم", "Name"), tr("اسم المستخدم", "Username"), tr("نوع الحساب", "Account Type"), tr("الدور", "Role"), tr("الحالة", "Status"), tr("المشروعات المسندة", "Assigned Projects"), tr("إجراءات", "Actions")].map((label) => <TableHead key={label} className="whitespace-nowrap text-start text-xs font-bold text-muted-foreground">{label}</TableHead>)}
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="p-0"><EmptyState compact title={tr("لا يوجد مستخدمون", "No users")} description={tr("أضف حسابًا ليظهر هنا.", "Add an account to see it here.")} /></TableCell>
              </TableRow>
            ) : users.map((row) => (
              <TableRow key={row.id} className="hover:bg-muted/50" data-testid="admin-users-row">
                <TableCell className="py-2 text-sm">
                  {row.display_name}
                  {row.account_type === "site_portal" && !row.phone && (
                    <div className="text-[10.5px] font-normal text-amber-600 dark:text-amber-400">{tr("بدون رقم واتساب", "No WhatsApp number")}</div>
                  )}
                </TableCell>
                <TableCell className="py-2 text-sm">{row.username}</TableCell>
                <TableCell className="py-2 text-sm">
                  {row.account_type === "erp" ? tr("نظام داخلي", "Internal System") : tr("بوابة طلبات الموقع", "Site Request Portal")}
                </TableCell>
                <TableCell className="py-2 text-sm">{roleLabel(row.role)}</TableCell>
                <TableCell className="py-2 text-sm">
                  <StatusBadge tone={row.active ? "success" : "danger"}>{row.active ? tr("مفعل", "Active") : tr("موقوف", "Disabled")}</StatusBadge>
                </TableCell>
                <TableCell className="py-2 text-sm">
                  {row.account_type === "site_portal" ? (
                    <div className="flex flex-wrap gap-1 items-center">
                      {row.assigned_projects.map((p) => (
                        <Badge key={p.id} variant="outline" className="gap-1">
                          {p.name}
                          <button
                            type="button"
                            aria-label={tr("إزالة", "Remove")}
                            onClick={() => removeProject(row.id, p.id)}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </Badge>
                      ))}
                      <Select onValueChange={(value) => assignProject(row.id, value)} value="">
                        <SelectTrigger
                          data-testid={`admin-users-project-select-${row.id}`}
                          className="h-7 w-32 text-xs"
                        >
                          <SelectValue placeholder={tr("+ مشروع", "+ Project")} />
                        </SelectTrigger>
                        <SelectContent dir={direction}>
                          {projects
                            .filter((p) => !row.assigned_projects.some((ap) => ap.id === p.id))
                            .map((p) => (
                              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="py-2">
                  <div className="flex gap-1">
                    <Button variant="outline" size="sm" data-testid="admin-users-edit-button" onClick={() => openEdit(row)}>
                      {tr("تعديل", "Edit")}
                    </Button>
                    <Button
                      variant="ghost" size="icon" className="h-7 w-7"
                      title={tr("إعادة تعيين كلمة المرور", "Reset password")}
                      onClick={() => { setResetTarget(row); setResetPassword(""); }}
                    >
                      <KeyRound className="h-3.5 w-3.5 text-muted-foreground" />
                    </Button>
                    <Button
                      variant="outline" size="sm"
                      className={row.active ? "text-red-600" : "text-emerald-600"}
                      onClick={() => toggleActive(row)}
                    >
                      {row.active ? tr("إيقاف", "Disable") : tr("تفعيل", "Activate")}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Create user */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent dir={direction} className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-start">{tr("إضافة مستخدم", "Add User")}</DialogTitle>
            <DialogDescription className="sr-only">{tr("أدخل بيانات الحساب الجديد", "Enter the new account details")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>{tr("الاسم", "Name")}</Label>
              <Input
                data-testid="admin-users-form-display-name"
                value={createForm.display_name}
                onChange={(e) => setCreateForm({ ...createForm, display_name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{tr("اسم المستخدم", "Username")}</Label>
              <Input
                data-testid="admin-users-form-username"
                value={createForm.username}
                onChange={(e) => setCreateForm({ ...createForm, username: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{tr("كلمة المرور المبدئية", "Initial Password")}</Label>
              <Input
                type="password"
                data-testid="admin-users-form-password"
                value={createForm.password}
                onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{tr("نوع الحساب", "Account Type")}</Label>
              <Select
                data-testid="admin-users-form-account-type"
                value={createForm.account_type}
                onValueChange={(value) => setCreateForm({
                  ...createForm, account_type: value,
                  role: value === "erp" ? "admin" : "site_engineer",
                  project_ids: [],
                })}
              >
                <SelectTrigger data-testid="admin-users-form-account-type-trigger">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent dir={direction}>
                  <SelectItem value="erp">{tr("نظام داخلي (ERP)", "Internal System (ERP)")}</SelectItem>
                  <SelectItem value="site_portal">{tr("بوابة طلبات الموقع", "Site Request Portal")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {createForm.account_type === "erp" ? (
              <div className="space-y-1.5">
                <Label>{tr("الدور", "Role")}</Label>
                <Select
                  data-testid="admin-users-form-role"
                  value={createForm.role}
                  onValueChange={(value) => setCreateForm({ ...createForm, role: value })}
                >
                  <SelectTrigger data-testid="admin-users-form-role-trigger">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent dir={direction}>
                    {ERP_ROLE_OPTIONS.map((r) => (
                      <SelectItem key={r.value} value={r.value}>{tr(r.label, r.labelEn)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>{tr("رقم واتساب (اختياري)", "WhatsApp Number (optional)")}</Label>
                <Input
                  data-testid="admin-users-form-phone"
                  placeholder="+201012345678"
                  value={createForm.phone}
                  onChange={(e) => setCreateForm({ ...createForm, phone: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{tr("المشروعات المسموح بها", "Allowed Projects")}</Label>
                <div
                  data-testid="admin-users-form-projects"
                  className="border rounded-md p-2 max-h-40 overflow-y-auto space-y-1"
                >
                  {projects.length === 0 && (
                    <p className="text-xs text-muted-foreground">{tr("لا توجد مشروعات متاحة حاليًا", "No projects are currently available")}</p>
                  )}
                  {projects.map((p) => (
                    <label key={p.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={createForm.project_ids.includes(p.id)}
                        onChange={(e) => setCreateForm({
                          ...createForm,
                          project_ids: e.target.checked
                            ? [...createForm.project_ids, p.id]
                            : createForm.project_ids.filter((id) => id !== p.id),
                        })}
                      />
                      {p.name}
                    </label>
                  ))}
                </div>
              </div>
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setCreateOpen(false)}>{tr("إلغاء", "Cancel")}</Button>
            <Button data-testid="admin-users-save-button" onClick={createUser} disabled={saving}>
              {saving ? tr("جارٍ الحفظ...", "Saving...") : tr("إنشاء الحساب", "Create Account")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit user */}
      <Dialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent dir={direction} className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-start">{tr("تعديل مستخدم", "Edit User")}</DialogTitle>
            <DialogDescription className="sr-only">{tr("تعديل بيانات الحساب", "Edit account details")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>{tr("الاسم", "Name")}</Label>
              <Input
                value={editForm.display_name || ""}
                onChange={(e) => setEditForm({ ...editForm, display_name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{tr("اسم المستخدم", "Username")}</Label>
              <Input
                value={editForm.username || ""}
                onChange={(e) => setEditForm({ ...editForm, username: e.target.value })}
              />
            </div>
            {editing?.account_type === "erp" ? (
              <div className="space-y-1.5">
                <Label>{tr("الدور", "Role")}</Label>
                <Select value={editForm.role} onValueChange={(value) => setEditForm({ ...editForm, role: value })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent dir={direction}>
                    {ERP_ROLE_OPTIONS.map((r) => (
                      <SelectItem key={r.value} value={r.value}>{tr(r.label, r.labelEn)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label>{tr("رقم واتساب (اختياري)", "WhatsApp Number (optional)")}</Label>
                <Input
                  data-testid="admin-users-edit-form-phone"
                  placeholder="+201012345678"
                  value={editForm.phone || ""}
                  onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                />
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setEditing(null)}>{tr("إلغاء", "Cancel")}</Button>
            <Button onClick={saveEdit}>{tr("حفظ التغييرات", "Save Changes")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset password */}
      <Dialog open={!!resetTarget} onOpenChange={(v) => !v && setResetTarget(null)}>
        <DialogContent dir={direction} className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-start">{tr("إعادة تعيين كلمة المرور", "Reset Password")}</DialogTitle>
            <DialogDescription className="text-start">
              {resetTarget?.display_name}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>{tr("كلمة المرور الجديدة", "New Password")}</Label>
            <Input
              type="password"
              data-testid="admin-users-reset-password-input"
              value={resetPassword}
              onChange={(e) => setResetPassword(e.target.value)}
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setResetTarget(null)}>{tr("إلغاء", "Cancel")}</Button>
            <Button data-testid="admin-users-reset-password-submit" onClick={submitResetPassword}>
              {tr("تعيين كلمة المرور", "Set Password")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
