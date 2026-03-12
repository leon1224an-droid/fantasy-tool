import React from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { Button, Surface, Text, useTheme, Divider } from "react-native-paper";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getCalendar, getRoster, getSavedRosters, ingestAll } from "../../lib/api";

const WEEK_DATES: Record<number, string> = {
  21: "Mar 16 – Mar 22",
  22: "Mar 23 – Mar 29",
  23: "Mar 30 – Apr 5",
};

export default function DashboardScreen() {
  const theme = useTheme();
  const queryClient = useQueryClient();

  const { data: calendar, isLoading, error } = useQuery({
    queryKey: ["calendar"],
    queryFn: getCalendar,
  });

  const { data: roster } = useQuery({
    queryKey: ["roster"],
    queryFn: getRoster,
  });

  const { data: savedRosters } = useQuery({
    queryKey: ["saved-rosters"],
    queryFn: getSavedRosters,
  });

  const ingestMutation = useMutation({
    mutationFn: ingestAll,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["calendar"] });
      queryClient.invalidateQueries({ queryKey: ["schedule-all"] });
      queryClient.invalidateQueries({ queryKey: ["team-days"] });
      queryClient.invalidateQueries({ queryKey: ["player-grid"] });
      queryClient.invalidateQueries({ queryKey: ["roster"] });
    },
  });

  // Detect which saved roster is active (if any) by matching player names
  const activeRosterName = React.useMemo(() => {
    if (!roster || !savedRosters) return null;
    const activeNames = new Set(roster.map((p) => p.name));
    for (const saved of savedRosters) {
      const savedNames = new Set(saved.players.map((p) => p.name));
      if (
        savedNames.size === activeNames.size &&
        [...savedNames].every((n) => activeNames.has(n))
      ) {
        return saved.name;
      }
    }
    return null;
  }, [roster, savedRosters]);

  // Sum players_available per week from calendar (matches "Total Games" in calendar view)
  const weekTotals = ([21, 22, 23] as const).map((wk) => {
    const weekData = calendar?.find((w) => w.week_num === wk);
    const total = weekData?.days.reduce((s, d) => s + d.players_available, 0) ?? 0;
    return { week: wk, total };
  });

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={[styles.heading, { color: theme.colors.onBackground }]}>Dashboard</Text>

        {activeRosterName && (
          <View style={styles.rosterBadge}>
            <Text style={styles.rosterBadgeLabel}>Active roster</Text>
            <Text style={styles.rosterBadgeName}>{activeRosterName}</Text>
          </View>
        )}

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
          <Text style={styles.errorText}>Ingest failed: {ingestMutation.error?.message}</Text>
        )}
        {ingestMutation.isSuccess && (
          <Text style={styles.successText}>Data refreshed successfully.</Text>
        )}

        {isLoading && <Text style={styles.hintText}>Loading…</Text>}
        {error && <Text style={styles.errorText}>{(error as Error).message}</Text>}

        {!isLoading && !error && (!calendar || calendar.length === 0) && (
          <Text style={styles.hintText}>No data — tap "Refresh Data" to ingest.</Text>
        )}

        {!isLoading && !error && calendar && calendar.length > 0 && (
          <Surface style={styles.card} elevation={1}>
            <Text style={styles.cardTitle}>Games This Playoff</Text>
            <View style={styles.cardDivider} />
            {weekTotals.map(({ week, total }) => (
              <View key={week} style={styles.weekRow}>
                <View>
                  <Text style={styles.weekLabel}>Week {week}</Text>
                  <Text style={styles.weekDates}>{WEEK_DATES[week]}</Text>
                </View>
                <Text style={styles.weekTotal}>{total} games</Text>
              </View>
            ))}
          </Surface>
        )}

        {roster && roster.length > 0 && (
          <Surface style={styles.card} elevation={1}>
            <Text style={styles.cardTitle}>My Roster ({roster.length})</Text>
            <View style={styles.cardDivider} />
            {roster.map((player, idx) => (
              <View key={player.name} style={[styles.rosterRow, idx < roster.length - 1 && styles.rosterRowBorder]}>
                <Text style={styles.rosterPlayerName} numberOfLines={1}>{player.name}</Text>
                <View style={styles.rosterMeta}>
                  <Text style={styles.rosterTeam}>{player.team}</Text>
                  <Text style={styles.rosterDot}>·</Text>
                  <Text style={styles.rosterPositions}>{player.positions.join(" / ")}</Text>
                </View>
              </View>
            ))}
          </Surface>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, paddingBottom: 32, gap: 12 },
  heading: { fontSize: 24, fontWeight: "800", letterSpacing: -0.5, marginBottom: 4 },

  rosterBadge: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "#ede7f6", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8,
  },
  rosterBadgeLabel: { fontSize: 12, color: "#7e57c2", fontWeight: "600" },
  rosterBadgeName: { fontSize: 14, color: "#4a148c", fontWeight: "800" },

  refreshBtn: { borderRadius: 12 },
  refreshBtnContent: { paddingVertical: 4 },
  errorText: { color: "#c62828", textAlign: "center", fontSize: 13 },
  successText: { color: "#2e7d32", textAlign: "center", fontSize: 13 },
  hintText: { color: "#888", textAlign: "center", fontSize: 13 },

  card: { borderRadius: 16, backgroundColor: "#fff", overflow: "hidden" },
  cardTitle: { fontSize: 15, fontWeight: "700", color: "#1a1a1a", padding: 18, paddingBottom: 12 },
  cardDivider: { height: StyleSheet.hairlineWidth, backgroundColor: "#f0f0f0", marginHorizontal: 18 },

  weekRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 18, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#f0f0f0",
  },
  weekLabel: { fontSize: 15, fontWeight: "600", color: "#1a1a1a" },
  weekDates: { fontSize: 12, color: "#888", marginTop: 2 },
  weekTotal: { fontSize: 22, fontWeight: "800", color: "#6750a4" },

  rosterRow: { paddingHorizontal: 18, paddingVertical: 12 },
  rosterRowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#f0f0f0" },
  rosterPlayerName: { fontSize: 14, fontWeight: "600", color: "#1a1a1a", marginBottom: 2 },
  rosterMeta: { flexDirection: "row", alignItems: "center", gap: 4 },
  rosterTeam: { fontSize: 12, color: "#888" },
  rosterDot: { fontSize: 12, color: "#ccc" },
  rosterPositions: { fontSize: 12, fontWeight: "600", color: "#6750a4" },
});
