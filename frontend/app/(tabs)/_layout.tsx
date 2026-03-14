import { Tabs } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useTheme } from "react-native-paper";

export default function TabLayout() {
  const theme = useTheme();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.onSurfaceVariant,
        tabBarStyle: { backgroundColor: theme.colors.surface, height: 56 },
        tabBarLabelStyle: { fontSize: 10, marginBottom: 4 },
        tabBarIconStyle: { marginTop: 2 },
        tabBarScrollEnabled: true,
        tabBarItemStyle: { width: 72 },
      }}
    >
      {/* Hidden tabs */}
      <Tabs.Screen name="lineup"      options={{ href: null }} />
      <Tabs.Screen name="schedule"    options={{ href: null }} />
      <Tabs.Screen name="projections" options={{ href: null }} />

      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons name="home" size={size - 2} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="roster"
        options={{
          title: "Roster",
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons name="account-group" size={size - 2} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="calendar"
        options={{
          title: "Calendar",
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons name="calendar-today" size={size - 2} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="player-grid"
        options={{
          title: "Grid",
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons name="grid" size={size - 2} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="teams"
        options={{
          title: "Teams",
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons name="trophy-outline" size={size - 2} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="compare"
        options={{
          title: "Compare",
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons name="scale-balance" size={size - 2} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="league"
        options={{
          title: "League",
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons name="tournament" size={size - 2} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="matchup"
        options={{
          title: "H2H",
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons name="sword-cross" size={size - 2} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
