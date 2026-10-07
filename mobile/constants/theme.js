import { Platform } from 'react-native';

// Design tokens. The base palette (bg / card / primary) is the original one;
// tones below are used by StatusBadge, KPIs and charts.
export const COLORS = {
  bg: '#1F2937',
  card: '#374151',
  cardRaised: '#3F4B5B',
  border: '#4B5563',
  primary: '#003DA5',
  accent: '#3B82F6',
  text: '#FFFFFF',
  textSecondary: '#D1D5DB',
  muted: '#9CA3AF',
  success: '#10B981',
  warning: '#F59E0B',
  danger: '#EF4444',
  info: '#38BDF8',
  neutral: '#9CA3AF',
};

// Badge/tint backgrounds: the tone color at low opacity.
export const TONES = {
  success: { fg: COLORS.success, bg: 'rgba(16, 185, 129, 0.16)' },
  warning: { fg: COLORS.warning, bg: 'rgba(245, 158, 11, 0.16)' },
  danger: { fg: COLORS.danger, bg: 'rgba(239, 68, 68, 0.16)' },
  info: { fg: COLORS.info, bg: 'rgba(56, 189, 248, 0.16)' },
  primary: { fg: COLORS.accent, bg: 'rgba(59, 130, 246, 0.18)' },
  neutral: { fg: COLORS.textSecondary, bg: 'rgba(156, 163, 175, 0.16)' },
};

// 8px base grid.
export const SPACING = { xxs: 2, xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 };

export const FONT = {
  xs: 11,
  sm: 12,
  body: 14,
  md: 15,
  lg: 17,
  xl: 20,
  xxl: 24,
  display: 30,
};

export const RADIUS = { sm: 6, md: 10, lg: 14, pill: 999 };

export const SHADOW = Platform.select({
  ios: {
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  default: { elevation: 3 },
});
