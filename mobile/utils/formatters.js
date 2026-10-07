export function formatMoney(value) {
  const number = Number(value || 0);
  return number.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

export function formatCount(value) {
  return Number(value || 0).toLocaleString('en-US');
}

// Backend timestamps are ISO strings; show the date part (and time if present).
export function formatDateTime(value) {
  if (!value) return '—';
  const [date, time = ''] = String(value).split('T');
  return time ? `${date} ${time.slice(0, 5)}` : date;
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

// Turn an axios error into a user-facing Arabic message.
export function errorMessage(error, fallback = 'حدث خطأ أثناء تحميل البيانات') {
  if (!error) return fallback;
  if (error.response) {
    const detail = error.response.data?.detail;
    if (typeof detail === 'string') return detail;
    if (error.response.status === 403) return 'ليس لديك صلاحية للوصول إلى هذه البيانات';
    return `${fallback} (${error.response.status})`;
  }
  if (error.code === 'ECONNABORTED') return 'انتهت مهلة الاتصال بالخادم';
  return 'تعذر الاتصال بالخادم، تأكد من عنوان الـAPI وأن الخادم يعمل';
}
