import React, { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import {
  ActivityIndicator,
  Button,
  Surface,
  Text,
  useTheme,
} from "react-native-paper";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getOptimize, ingestAll, WeeklyLineupResponse } from "../../lib/api";

const WEEK_DATES: Record<number, string> = {
  21: "Mar 16 – Mar 22",
  22: "Mar 23 – Mar 29",
  23: "Mar 30 – Apr 5",
};

export default function DashboardScreen() {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const { data: lineups, isLoading, error } = useQuery({
    queryKey: ["optimize"],
    queryFn: () => getOptimize(),
  });

  const ingestMutation = useMutation({
    mutationFn: ingestAll,
    onSuccess: () => {
      setLastRefresh(new Date());
      queryClient.invalidateQueries({ queryKey: ["optimize"] });
      queryClient.invalidateQueries({ queryKey: ["schedule"] });
      queryClient.invalidateQueries({ queryKey: ["projections"] });
      queryClient.invalidateQueries({ queryKey: ["calendar"] });
      queryClient.invalidateQueries({ queryKey: ["player-grid"] });
    },
  });

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={[styles.heading, { color: theme.colors.onBackground }]}>
            Playoff Optimizer
          </Text>
          {lastRefresh && (
            <Text style={styles.lastRefresh}>
              Updated {lastRefresh.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </Text>
          )}
        </View>

        {/* Refresh button */}
        <Button
          mode="contained"
          onPress={() => ingestMutation.mutate()}
          loading={ingestMutation.isPending}
          disabled={ingestMutation.isPending}
          icon="database-refresh"
          style={styles.refreshBtn}
          contentStyle={styles.refreshBtnContent}
        >
          {ingestMutation.isPending ? "Ingesting data…" : "Refresh Data"}
        </Button>

        {ingestMutation.isError && (
          <Text style={styles.errorText}>
            Ingest failed: {ingestMutation.error?.message}
          </Text>
        )}

        {/* Loading */}
        {isLoading && <ActivityIndicator size="large" style={styles.spinner} />}

        {/* No data hint */}
        {error && (
          <Text style={styles.hintText}>
            {(error as Error).message.includes("No projection")
              ? 'No data yet — tap "Refresh Data" to ingest.'
              : (error as Error).message}
          </Text>
        )}

        {/* Week cards */}
        {lineups?.map((lineup) => (
          <WeekCard key={lineup.week_num} lineup={lineup} />
        ))}
      </ScrollView>
    </View>
  );
}

function WeekCard({ lineup }: { lineup: WeeklyLineupResponse }) {
  const top3 = lineup.starters.slice(0, 3);

  return (
    <Surface style={styles.card} elevation={1}>
      <View style={styles.cardHeader}>
        <View>
          <Text style={styles.cardWeek}>Week {lineup.week_num}</Text>
          <Text style={styles.cardDates}>{WEEK_DATES[lineup.week_num] ?? ""}</Text>
        </View>
        <View style={styles.ptsBadge}>
          <Text style={styles.ptsValue}>{lineup.total_projected.toFixed(1)}</Text>
          <Text style={styles.ptsLabel}>pts</Text>
        </View>
      </View>

      <View style={styles.cardDivider} />

      <View style={styles.startersSection}>
        <Text style={styles.startersTitle}>Top starters</Text>
        {top3.map((s) => (
          <View key={s.slot} style={styles.starterRow}>
            <Text style={styles.starterSlot}>{s.slot}</Text>
            <Text style={styles.starterName} numberOfLines={1}>{s.player}</Text>
            <Text style={styles.starterPts}>{s.projected_total.toFixed(1)}</Text>
          </View>
        ))}
      </View>
    </Surface>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, paddingBottom: 32, gap: 12 },

  header: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginBottom: 4 },
  heading: { fontSize: 24, fontWeight: "800", letterSpacing: -0.5 },
  lastRefresh: { fontSize: 11, color: "#aaa" },

  refreshBtn: { borderRadius: 12 },
  refreshBtnContent: { paddingVertical: 4 },
  errorText: { color: "#c62828", textAlign: "center", fontSize: 13 },
  hintText: { color: "#888", textAlign: "center", fontSize: 13 },
  spinner: { marginTop: 32 },

  // Week cards
  card: {
    borderRadius: 16,
    backgroundColor: "#fff",
    overflow: "hidden",
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 12,
  },
  cardWeek: { fontSize: 17, fontWeight: "700", color: "#1a1a1a" },
  cardDates: { fontSize: 12, color: "#888", marginTop: 2 },
  ptsBadge: { alignItems: "flex-end" },
  ptsValue: { fontSize: 26, fontWeight: "800", color: "#6750a4", lineHeight: 30 },
  ptsLabel: { fontSize: 10, color: "#888", textAlign: "right" },
  cardDivider: { height: StyleSheet.hairlineWidth, backgroundColor: "#f0f0f0", marginHorizontal: 18 },
  startersSection: { paddingHorizontal: 18, paddingTop: 10, paddingBottom: 14 },
  startersTitle: { fontSize: 11, fontWeight: "600", color: "#aaa", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 },
  starterRow: { flexDirection: "row", alignItems: "center", paddingVertical: 3 },
  starterSlot: { fontSize: 11, fontWeight: "700", color: "#6750a4", width: 40 },
  starterName: { flex: 1, fontSize: 14, color: "#1a1a1a" },
  starterPts: { fontSize: 14, fontWeight: "600", color: "#555" },
});
