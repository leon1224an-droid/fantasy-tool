import React, { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import {
  Appbar,
  Button,
  Card,
  Text,
  useTheme,
  ActivityIndicator,
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
    enabled: true,
  });

  const ingestMutation = useMutation({
    mutationFn: ingestAll,
    onSuccess: () => {
      setLastRefresh(new Date());
      queryClient.invalidateQueries({ queryKey: ["optimize"] });
      queryClient.invalidateQueries({ queryKey: ["schedule"] });
      queryClient.invalidateQueries({ queryKey: ["projections"] });
    },
  });

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <Appbar.Header>
        <Appbar.Content title="Fantasy Playoff Optimizer" />
        <Appbar.Action
          icon="refresh"
          onPress={() => ingestMutation.mutate()}
          disabled={ingestMutation.isPending}
        />
      </Appbar.Header>

      <ScrollView contentContainerStyle={styles.content}>
        {/* Refresh button */}
        <Button
          mode="contained"
          onPress={() => ingestMutation.mutate()}
          loading={ingestMutation.isPending}
          disabled={ingestMutation.isPending}
          icon="database-refresh"
          style={styles.refreshBtn}
        >
          {ingestMutation.isPending ? "Ingesting data…" : "Refresh Data"}
        </Button>

        {ingestMutation.isError && (
          <Text style={styles.errorText}>
            Ingest failed: {ingestMutation.error?.message}
          </Text>
        )}

        {lastRefresh && (
          <Text style={styles.lastRefresh}>
            Last refresh: {lastRefresh.toLocaleTimeString()}
          </Text>
        )}

        {/* Week summary cards */}
        {isLoading && (
          <ActivityIndicator size="large" style={{ marginTop: 32 }} />
        )}
        {error && (
          <Text style={styles.errorText}>
            {(error as Error).message.includes("No projection")
              ? 'No data yet — tap "Refresh Data" to ingest.'
              : (error as Error).message}
          </Text>
        )}
        {lineups && lineups.map((lineup) => (
          <WeekCard key={lineup.week_num} lineup={lineup} />
        ))}
      </ScrollView>
    </View>
  );
}

function WeekCard({ lineup }: { lineup: WeeklyLineupResponse }) {
  const top3 = lineup.starters.slice(0, 3);

  return (
    <Card style={styles.card} mode="elevated">
      <Card.Title
        title={`Week ${lineup.week_num}`}
        subtitle={WEEK_DATES[lineup.week_num] ?? ""}
        right={(props) => (
          <Text {...props} style={styles.totalPts}>
            {lineup.total_projected.toFixed(1)} pts
          </Text>
        )}
      />
      <Card.Content>
        <Text style={styles.topLabel}>Top starters:</Text>
        {top3.map((s) => (
          <Text key={s.slot} style={styles.starterRow}>
            <Text style={styles.slotBadge}>{s.slot} </Text>
            {s.player} — {s.projected_total.toFixed(1)}
          </Text>
        ))}
      </Card.Content>
    </Card>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12 },
  refreshBtn: { marginBottom: 4 },
  errorText: { color: "#cf6679", textAlign: "center", marginVertical: 8 },
  lastRefresh: { fontSize: 12, color: "#888", textAlign: "center" },
  card: { marginVertical: 4 },
  totalPts: {
    fontSize: 18,
    fontWeight: "800",
    color: "#6750a4",
    marginRight: 16,
  },
  topLabel: { fontSize: 13, fontWeight: "600", marginBottom: 4 },
  starterRow: { fontSize: 13, paddingVertical: 2 },
  slotBadge: { fontWeight: "700" },
});
