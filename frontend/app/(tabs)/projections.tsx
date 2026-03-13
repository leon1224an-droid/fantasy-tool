import React, { useState, useMemo } from "react";
import { FlatList, StyleSheet, View } from "react-native";
import { Chip, Text, useTheme } from "react-native-paper";
import { useQuery } from "@tanstack/react-query";
import { getProjections, getActiveSource } from "../../lib/api";
import { WeekSelector } from "../../components/WeekSelector";
import { ProjectionCard } from "../../components/ProjectionCard";
import { LoadingOrError } from "../../components/LoadingOrError";

const SOURCE_LABELS: Record<string, string> = {
  nba_api: "NBA API",
  yahoo: "Yahoo",
  bball_monster: "Basketball Monster",
  blended: "Blended",
};

const SOURCE_COLORS: Record<string, string> = {
  nba_api: "#1565c0",
  yahoo: "#6a0dad",
  bball_monster: "#2e7d32",
  blended: "#e65100",
};

export default function ProjectionsScreen() {
  const theme = useTheme();
  const [week, setWeek] = useState(21);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["projections", week],
    queryFn: () => getProjections(week),
  });

  const { data: sourceData } = useQuery({
    queryKey: ["projection-source"],
    queryFn: getActiveSource,
  });

  const sorted = useMemo(
    () =>
      data
        ? [...data].sort((a, b) => b.projected_total - a.projected_total)
        : [],
    [data]
  );

  const activeSource = sourceData?.active_source ?? "nba_api";
  const sourceColor = SOURCE_COLORS[activeSource] ?? "#666";

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <WeekSelector value={week} onChange={setWeek} />

      {/* Active source badge */}
      {sourceData && (
        <View style={styles.badgeRow}>
          <Chip
            compact
            style={[styles.sourceBadge, { backgroundColor: sourceColor + "18" }]}
            textStyle={[styles.sourceBadgeText, { color: sourceColor }]}
            icon="database"
          >
            {SOURCE_LABELS[activeSource] ?? activeSource}
          </Chip>
        </View>
      )}

      {(isLoading || error) && (
        <LoadingOrError
          loading={isLoading}
          error={error as Error | null}
          onRetry={refetch}
        />
      )}

      {sorted.length > 0 && (
        <FlatList
          data={sorted}
          keyExtractor={(item) => `${item.player}-${item.week_num}`}
          renderItem={({ item }) => <ProjectionCard projection={item} />}
          contentContainerStyle={styles.list}
        />
      )}

      {!isLoading && !error && sorted.length === 0 && (
        <Text style={styles.emptyText}>
          No projection data. Run "Refresh Data" on the Dashboard first.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { paddingBottom: 24 },
  emptyText: {
    color: "#888",
    textAlign: "center",
    margin: 32,
    fontSize: 14,
  },
  badgeRow: {
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  sourceBadge: {
    alignSelf: "flex-start",
    borderRadius: 20,
  },
  sourceBadgeText: {
    fontSize: 12,
    fontWeight: "700",
  },
});
