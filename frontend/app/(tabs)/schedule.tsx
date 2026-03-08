import React, { useMemo } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { DataTable, Text, useTheme } from "react-native-paper";
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
  if (n >= 4) return "#2e7d32"; // green
  if (n <= 2) return "#c62828"; // red
  return "#e65100"; // orange for 3
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
    return Object.values(map).sort((a, b) => a.team.localeCompare(b.team));
  }, [data]);

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Text style={[styles.title, { color: theme.colors.onBackground }]}>
        Team Schedule
      </Text>

      {(isLoading || error) && (
        <LoadingOrError
          loading={isLoading}
          error={error as Error | null}
          onRetry={refetch}
        />
      )}

      {rows.length > 0 && (
        <ScrollView>
          <DataTable>
            <DataTable.Header>
              <DataTable.Title style={styles.teamCol}>Team</DataTable.Title>
              <DataTable.Title numeric style={styles.weekCol}>Wk 21</DataTable.Title>
              <DataTable.Title numeric style={styles.weekCol}>Wk 22</DataTable.Title>
              <DataTable.Title numeric style={styles.weekCol}>Wk 23</DataTable.Title>
              <DataTable.Title numeric style={styles.weekCol}>Total</DataTable.Title>
            </DataTable.Header>

            {rows.map((row) => (
              <DataTable.Row key={row.team}>
                <DataTable.Cell style={styles.teamCol}>
                  <Text style={styles.teamText}>{row.team}</Text>
                </DataTable.Cell>
                <DataTable.Cell numeric style={styles.weekCol}>
                  <Text style={{ color: gamesColor(row.w21), fontWeight: "700" }}>
                    {row.w21}
                  </Text>
                </DataTable.Cell>
                <DataTable.Cell numeric style={styles.weekCol}>
                  <Text style={{ color: gamesColor(row.w22), fontWeight: "700" }}>
                    {row.w22}
                  </Text>
                </DataTable.Cell>
                <DataTable.Cell numeric style={styles.weekCol}>
                  <Text style={{ color: gamesColor(row.w23), fontWeight: "700" }}>
                    {row.w23}
                  </Text>
                </DataTable.Cell>
                <DataTable.Cell numeric style={styles.weekCol}>
                  <Text style={{ fontWeight: "800" }}>{row.total}</Text>
                </DataTable.Cell>
              </DataTable.Row>
            ))}
          </DataTable>

          <View style={styles.legend}>
            <Text style={[styles.legendItem, { color: gamesColor(4) }]}>
              ● 4 games (best)
            </Text>
            <Text style={[styles.legendItem, { color: gamesColor(3) }]}>
              ● 3 games
            </Text>
            <Text style={[styles.legendItem, { color: gamesColor(2) }]}>
              ● 2 games (fewest)
            </Text>
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
  title: {
    fontSize: 22,
    fontWeight: "700",
    marginTop: 16,
    marginHorizontal: 16,
    marginBottom: 8,
  },
  teamCol: { flex: 2 },
  weekCol: { flex: 1 },
  teamText: { fontWeight: "600" },
  legend: {
    flexDirection: "row",
    justifyContent: "space-around",
    padding: 16,
  },
  legendItem: { fontSize: 12, fontWeight: "600" },
  emptyText: {
    color: "#888",
    textAlign: "center",
    margin: 32,
    fontSize: 14,
  },
});
