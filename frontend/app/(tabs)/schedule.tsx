import React, { useMemo } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { Surface, Text, useTheme } from "react-native-paper";
import { useQuery } from "@tanstack/react-query";
import { getSchedule, ScheduleRow } from "../../lib/api";
import { LoadingOrError } from "../../components/LoadingOrError";

interface TeamRow {
  team: string;
  w21: number;
  w22: number;
  w23: number;
  total: number;
}

function gamesColor(n: number): string {
  if (n >= 4) return "#2e7d32";
  if (n === 3) return "#1565c0";
  if (n <= 2) return "#c62828";
  return "#555";
}

function GamesBadge({ n }: { n: number }) {
  const color = gamesColor(n);
  return (
    <View style={[styles.badge, { backgroundColor: color + "18" }]}>
      <Text style={[styles.badgeText, { color }]}>{n}</Text>
    </View>
  );
}

export default function ScheduleScreen() {
  const theme = useTheme();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["schedule"],
    queryFn: getSchedule,
  });

  const rows: TeamRow[] = useMemo(() => {
    if (!data) return [];
    const map: Record<string, TeamRow> = {};
    for (const row of data) {
      if (!map[row.team]) {
        map[row.team] = { team: row.team, w21: 0, w22: 0, w23: 0, total: 0 };
      }
      const key = `w${row.week_num}` as keyof TeamRow;
      (map[row.team] as Record<string, number>)[key as string] = row.games_count;
      map[row.team].total += row.games_count;
    }
    return Object.values(map).sort((a, b) => b.total - a.total);
  }, [data]);

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {(isLoading || error) && (
        <LoadingOrError loading={isLoading} error={error as Error | null} onRetry={refetch} />
      )}

      {rows.length > 0 && (
        <ScrollView style={styles.flex1} contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <Surface style={styles.surface} elevation={1}>
            {/* Header */}
            <View style={styles.tableHeader}>
              <Text style={[styles.colLabel, styles.teamColW]}>Team</Text>
              <Text style={[styles.colLabel, styles.weekColW]}>Wk 21</Text>
              <Text style={[styles.colLabel, styles.weekColW]}>Wk 22</Text>
              <Text style={[styles.colLabel, styles.weekColW]}>Wk 23</Text>
              <Text style={[styles.colLabel, styles.totalColW]}>Total</Text>
            </View>

            {rows.map((row, idx) => (
              <View
                key={row.team}
                style={[styles.tableRow, idx % 2 === 1 && styles.tableRowAlt]}
              >
                <Text style={[styles.teamText, styles.teamColW]}>{row.team}</Text>
                <View style={styles.weekColW}><GamesBadge n={row.w21} /></View>
                <View style={styles.weekColW}><GamesBadge n={row.w22} /></View>
                <View style={styles.weekColW}><GamesBadge n={row.w23} /></View>
                <Text style={[styles.totalText, styles.totalColW]}>{row.total}</Text>
              </View>
            ))}
          </Surface>

          {/* Legend */}
          <View style={styles.legend}>
            {[{ n: 4, label: "4 games" }, { n: 3, label: "3 games" }, { n: 2, label: "2 games" }].map(({ n, label }) => (
              <View key={n} style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: gamesColor(n) }]} />
                <Text style={styles.legendText}>{label}</Text>
              </View>
            ))}
          </View>
        </ScrollView>
      )}

      {!isLoading && !error && rows.length === 0 && (
        <Text style={styles.emptyText}>
          No schedule data. Run "Refresh Data" on the Dashboard first.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex1: { flex: 1 },
  scroll: { padding: 16, paddingBottom: 32 },
  surface: { borderRadius: 16, backgroundColor: "#fff", overflow: "hidden" },

  tableHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: "#6750a4",
  },
  colLabel: { fontSize: 11, fontWeight: "700", color: "#fff", textTransform: "uppercase", letterSpacing: 0.4, textAlign: "center" },

  tableRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#f0f0f0",
    minHeight: 44,
  },
  tableRowAlt: { backgroundColor: "#fafafa" },

  teamColW: { width: 52, textAlign: "left" },
  weekColW: { flex: 1, alignItems: "center" },
  totalColW: { width: 48, textAlign: "right" },

  teamText: { fontSize: 13, fontWeight: "700", color: "#1a1a1a" },
  totalText: { fontSize: 15, fontWeight: "800", color: "#6750a4" },

  badge: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, alignSelf: "center" },
  badgeText: { fontSize: 14, fontWeight: "700" },

  legend: { flexDirection: "row", justifyContent: "center", gap: 20, marginTop: 14 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { fontSize: 12, color: "#666" },

  emptyText: { color: "#888", textAlign: "center", margin: 32, fontSize: 14 },
});
