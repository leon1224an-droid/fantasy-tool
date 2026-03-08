import React, { useState, useMemo } from "react";
import { FlatList, StyleSheet, View } from "react-native";
import { Text, useTheme } from "react-native-paper";
import { useQuery } from "@tanstack/react-query";
import { getProjections } from "../../lib/api";
import { WeekSelector } from "../../components/WeekSelector";
import { ProjectionCard } from "../../components/ProjectionCard";
import { LoadingOrError } from "../../components/LoadingOrError";

export default function ProjectionsScreen() {
  const theme = useTheme();
  const [week, setWeek] = useState(21);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["projections", week],
    queryFn: () => getProjections(week),
  });

  const sorted = useMemo(
    () =>
      data
        ? [...data].sort((a, b) => b.projected_total - a.projected_total)
        : [],
    [data]
  );

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Text style={[styles.title, { color: theme.colors.onBackground }]}>
        Player Projections
      </Text>

      <WeekSelector value={week} onChange={setWeek} />

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
  title: {
    fontSize: 22,
    fontWeight: "700",
    marginTop: 16,
    marginHorizontal: 16,
  },
  list: { paddingBottom: 24 },
  emptyText: {
    color: "#888",
    textAlign: "center",
    margin: 32,
    fontSize: 14,
  },
});
