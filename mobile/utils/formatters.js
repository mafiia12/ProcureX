export function formatMoney(value) {
  const number = Number(value || 0);
  return number.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

// 3475 → "3,475 ج.م"
export function formatCurrency(value) {
  if (value === null || value === undefined || value === '') return '—';
  return `${formatMoney(value)} ج.م`;
}

export function formatCount(value) {
  return Number(value || 0).toLocaleString('en-US');
}

export function formatQuantity(value) {
  return Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 3 });
}

export function formatPercent(value) {
  if (value === null || value === undefined) return '—';
  return `${Number(value).toLocaleString('en-US', { maximumFractionDigits: 1 })}%`;
}

// Backend timestamps are ISO strings; show the date part (and time if present).
export function formatDateTime(value) {
  if (!value) return '—';
  const [date, time = ''] = String(value).split('T');
  return time ? `${formatDate(date)} · ${time.slice(0, 5)}` : formatDate(date);
}

// Month names are spelled out here rather than via Intl so the output is the
// same on every device/Hermes build.
const ARABIC_MONTHS = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];
const ARABIC_WEEKDAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

function parseIsoDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
  if (!match) return null;
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

// "2026-10-07" → "7 أكتوبر 2026"
export function formatDate(value) {
  const parts = parseIsoDate(value);
  if (!parts) return value ? String(value) : '—';
  return `${parts.d} ${ARABIC_MONTHS[parts.m - 1]} ${parts.y}`;
}

// "2026-10-07" → "الأربعاء، 7 أكتوبر 2026"
export function formatLongDate(value) {
  const parts = parseIsoDate(value);
  if (!parts) return formatDate(value);
  const weekday = ARABIC_WEEKDAYS[new Date(parts.y, parts.m - 1, parts.d).getDay()];
  return `${weekday}، ${formatDate(value)}`;
}

export function toIsoDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function shiftIsoDate(isoDate, days) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return toIsoDate(new Date(y, m - 1, d + days));
}

// ---------------- Status labels ----------------
// Values mirror the backend vocabularies; tones map to theme.TONES.

// backend/incoming_requests.py REQUEST_STATUSES
const REQUEST_STATUS = {
  new: ['جديد', 'info'],
  under_review: ['قيد المراجعة', 'info'],
  need_clarification: ['يحتاج توضيح', 'warning'],
  hold: ['معلق', 'neutral'],
  pricing: ['قيد التسعير', 'primary'],
  waiting_for_approval: ['بانتظار الاعتماد', 'primary'],
  approved: ['معتمد', 'success'],
  rejected: ['مرفوض', 'danger'],
  converted_to_purchase: ['تم التحويل لأمر شراء', 'success'],
  completed: ['مكتمل', 'success'],
  cancelled: ['ملغي', 'neutral'],
};

// backend/incoming_requests.py ITEM_REVIEW_STATUSES
const ITEM_REVIEW_STATUS = {
  pending: ['بانتظار المراجعة', 'neutral'],
  approved: ['معتمد', 'success'],
  rejected: ['مرفوض', 'danger'],
  need_clarification: ['يحتاج توضيح', 'warning'],
  hold: ['معلق', 'neutral'],
};

// backend/incoming_requests.py PRIORITIES
const PRIORITY = {
  urgent: ['عاجل جدًا', 'danger'],
  high: ['عالية', 'warning'],
  normal: ['عادية', 'primary'],
  low: ['منخفضة', 'neutral'],
};

// backend/server.py PO_STATUS_LABELS
const PO_STATUS = {
  draft: ['مسودة', 'neutral'],
  approved: ['معتمد', 'primary'],
  sent: ['تم الإرسال للمورد', 'info'],
  supplier_confirmed: ['تأكيد المورد', 'info'],
  in_delivery: ['قيد التوريد', 'warning'],
  partial_received: ['استلام جزئي', 'warning'],
  delivery_problem: ['مشكلة في التوريد', 'danger'],
  completed: ['مكتمل', 'success'],
  cancelled: ['ملغي', 'neutral'],
};

// backend/server.py PO_PAYMENT_STATUS_LABELS
const PO_PAYMENT_STATUS = {
  unpaid: ['غير مدفوع', 'danger'],
  not_due: ['لم يحن السداد', 'neutral'],
  due: ['مستحق السداد', 'warning'],
  partially_paid: ['مدفوع جزئيًا', 'warning'],
  paid: ['مدفوع بالكامل', 'success'],
};

const STATUS_MAPS = {
  request: REQUEST_STATUS,
  item: ITEM_REVIEW_STATUS,
  priority: PRIORITY,
  po: PO_STATUS,
  payment: PO_PAYMENT_STATUS,
};

// → { label, tone }; unknown values fall back to the raw value, neutral tone.
export function statusMeta(kind, value) {
  const entry = STATUS_MAPS[kind]?.[value];
  if (entry) return { label: entry[0], tone: entry[1] };
  return { label: value ? String(value) : '—', tone: 'neutral' };
}

export function statusLabel(kind, value) {
  return statusMeta(kind, value).label;
}

// Canonical ordering of a vocabulary (workflow order), for filter chips.
export function statusOrder(kind) {
  return Object.keys(STATUS_MAPS[kind] || {});
}

// backend/auth/models.py ERP_ROLES (+ the site portal role)
const ROLE_LABELS = {
  admin: 'مدير النظام',
  procurement_responsible: 'مسؤول المشتريات',
  procurement_engineer: 'مهندس مشتريات',
  commercial_manager: 'المدير التجاري',
  site_engineer: 'مهندس موقع',
};

export function roleLabel(role) {
  return ROLE_LABELS[role] || role || '—';
}

// Case-insensitive "contains" over several fields, for client-side search.
export function matchesSearch(query, ...fields) {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return true;
  return fields.some((field) => String(field || '').toLowerCase().includes(needle));
}

// Turn an axios error into a user-facing Arabic message.
export function errorMessage(error, fallback = 'حدث خطأ أثناء تحميل البيانات') {
  if (!error) return fallback;
  if (error.response) {
    const detail = error.response.data?.detail;
    if (typeof detail === 'string') return detail;
    if (error.response.status === 403) return 'ليس لديك صلاحية للوصول إلى هذه البيانات';
    if (error.response.status === 404) return 'العنصر غير موجود';
    return `${fallback} (${error.response.status})`;
  }
  if (error.code === 'ECONNABORTED') return 'انتهت مهلة الاتصال بالخادم';
  return 'تعذر الاتصال بالخادم، تأكد من عنوان الـAPI وأن الخادم يعمل';
}
