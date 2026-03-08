import React, { useState } from "react";
import { View, StyleSheet } from "react-native";
import { Text, useTheme } from "react-native-paper";
import { useQuery } from "@tanstack/react-query";
import { getOptimize } from "../../lib/api";
import { WeekSelector } from "../../components/WeekSelector";
import { LineupTable } from "../../components/LineupTable";
import { LoadingOrError } from "../../components/LoadingOrError";

export default function LineupScreen() {
  const theme = useTheme();
  const [week, setWeek] = useState(21);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["optimize", week],
    queryFn: () => getOptimize(week),
  });

  const lineup = data?.[0];

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Text style={[styles.title, { color: theme.colors.onBackground }]}>
        Optimal Lineup
      </Text>

      <WeekSelector value={week} onChange={setWeek} />

      {(isLoading || error) && (
        <LoadingOrError
          loading={isLoading}
          error={error as Error | null}
          onRetry={refetch}
        />
      )}

      {lineup && (
        <LineupTable
          starters={lineup.starters}
          bench={lineup.bench}
          totalProjected={lineup.total_projected}
        />
      )}

      {!isLoading && !error && !lineup && (
        <Text style={styles.emptyText}>
          No lineup data. Run "Refresh Data" on the Dashboard first.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  title: {
    fontSize: 22,
    fontWeight: "700",
    marginTop: 16,
    marginHorizontal: 16,
  },
  emptyText: {
    color: "#888",
    textAlign: "center",
    margin: 32,
    fontSize: 14,
  },
});
