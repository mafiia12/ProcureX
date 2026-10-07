import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';

import { COLORS } from '../../constants/colors';

const TABS = [
  { name: 'dashboard', title: 'الرئيسية', icon: 'home' },
  { name: 'requests', title: 'الطلبات', icon: 'inbox' },
  { name: 'daily-report', title: 'التقرير', icon: 'chart-bar' },
  { name: 'comparisons', title: 'المقارنات', icon: 'compare-horizontal' },
  { name: 'settings', title: 'الإعدادات', icon: 'cog' },
];

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: COLORS.card, borderTopColor: COLORS.border },
        tabBarActiveTintColor: COLORS.accent,
        tabBarInactiveTintColor: COLORS.textSecondary,
        tabBarLabelStyle: { fontSize: 12 },
        sceneStyle: { backgroundColor: COLORS.bg },
      }}
    >
      {TABS.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: tab.title,
            tabBarIcon: ({ color, size }) => (
              <MaterialCommunityIcons name={tab.icon} size={size} color={color} />
            ),
          }}
        />
      ))}
    </Tabs>
  );
}
