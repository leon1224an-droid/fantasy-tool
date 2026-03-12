import React, { useState, useMemo } from "react";
import { ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import { DataTable, SegmentedButtons, Text, useTheme } from "react-native-paper";
import { useQuery } from "@tanstack/react-query";
import { getPlayerGrid, PlayerGridRow } from "../../lib/api";
import { LoadingOrError } from "../../components/LoadingOrError";

type ViewMode = "grid" | "summary";

export default function PlayerGridScreen() {
  const theme = useTheme();
  const [viewMode, setViewMode] = useState<ViewMode>("summary");
  const [week, setWeek] = useState<"21" | "22" | "23" | "all">("all");

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["player-grid"],
    queryFn: getPlayerGrid,
  });

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Text style={[styles.title, { color: theme.colors.onBackground }]}>
        Player Grid
      </Text>
      <Text style={[styles.subtitle, { color: theme.colors.onSurfaceVariant }]}>
        Raw games vs. startable days (after position constraints)
      </Text>

      <View style={styles.controls}>
        <SegmentedButtons
          value={viewMode}
          onValueChange={(v) => setViewMode(v as ViewMode)}
          buttons={[
            { value: "summary", label: "Summary" },
            { value: "grid", label: "Game Grid" },
          ]}
        />
      </View>

      {(isLoading || error) && (
        <LoadingOrError loading={isLoading} error={error as Error | null} onRetry={refetch} />
      )}

      <View style={styles.flex1}>
        {data && viewMode === "summary" && <SummaryView data={data} />}
        {data && viewMode === "grid" && <GridView data={data} week={week} setWeek={setWeek} />}

        {!isLoading && !error && !data && (
          <Text style={styles.emptyText}>
            No data. Run "Refresh Data" on the Dashboard first.
          </Text>
        )}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Summary view — raw vs playable table
// ---------------------------------------------------------------------------
function SummaryView({ data }: { data: PlayerGridRow[] }) {
  const sorted = useMemo(
    () => [...data].sort((a, b) => b.raw_grand_total - a.raw_grand_total),
    [data]
  );

  const totalRaw = sorted.reduce((s, p) => s + p.raw_grand_total, 0);
  const totalPlayable = sorted.reduce((s, p) => s + p.playable_grand_total, 0);

  return (
    <ScrollView style={styles.flex1}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <DataTable style={styles.summaryTable}>
        <DataTable.Header>
          <DataTable.Title style={styles.nameCol}>Player</DataTable.Title>
          <DataTable.Title numeric style={styles.numCol}>W21</DataTable.Title>
          <DataTable.Title numeric style={styles.numCol}>W22</DataTable.Title>
          <DataTable.Title numeric style={styles.numCol}>W23</DataTable.Title>
          <DataTable.Title numeric style={styles.numCol}>Raw</DataTable.Title>
          <DataTable.Title numeric style={styles.numCol}>Start</DataTable.Title>
        </DataTable.Header>

        {sorted.map((row) => (
          <DataTable.Row key={row.player}>
            <DataTable.Cell style={styles.nameCol}>
              <View>
                <Text style={styles.playerName}>{row.player}</Text>
                <Text style={styles.playerMeta}>{row.team} · {row.positions.join("/")}</Text>
              </View>
            </DataTable.Cell>
            <DataTable.Cell numeric style={styles.numCol}>
              <WeekCell raw={row.raw_totals["21"] ?? 0} play={row.playable_totals["21"] ?? 0} />
            </DataTable.Cell>
            <DataTable.Cell numeric style={styles.numCol}>
              <WeekCell raw={row.raw_totals["22"] ?? 0} play={row.playable_totals["22"] ?? 0} />
            </DataTable.Cell>
            <DataTable.Cell numeric style={styles.numCol}>
              <WeekCell raw={row.raw_totals["23"] ?? 0} play={row.playable_totals["23"] ?? 0} />
            </DataTable.Cell>
            <DataTable.Cell numeric style={styles.numCol}>
              <Text style={styles.boldNum}>{row.raw_grand_total}</Text>
            </DataTable.Cell>
            <DataTable.Cell numeric style={styles.numCol}>
              <Text style={[
                styles.boldNum,
                { color: row.playable_grand_total < row.raw_grand_total ? "#e65100" : "#2e7d32" }
              ]}>
                {row.playable_grand_total}
              </Text>
            </DataTable.Cell>
          </DataTable.Row>
        ))}

        {/* Totals row */}
        <DataTable.Row style={styles.totalsRow}>
          <DataTable.Cell style={styles.nameCol}>
            <Text style={styles.totalsLabel}>ROSTER TOTAL</Text>
          </DataTable.Cell>
          <DataTable.Cell numeric style={styles.numCol} />
          <DataTable.Cell numeric style={styles.numCol} />
          <DataTable.Cell numeric style={styles.numCol} />
          <DataTable.Cell numeric style={styles.numCol}>
            <Text style={styles.totalsNum}>{totalRaw}</Text>
          </DataTable.Cell>
          <DataTable.Cell numeric style={styles.numCol}>
            <Text style={[styles.totalsNum, { color: totalPlayable < totalRaw ? "#e65100" : "#2e7d32" }]}>
              {totalPlayable}
            </Text>
          </DataTable.Cell>
        </DataTable.Row>
      </DataTable>
      </ScrollView>

      <View style={styles.legend}>
        <Text style={styles.legendTitle}>Raw vs Start explained:</Text>
        <Text style={styles.legendText}>
          Raw = total games your player's team plays.{"\n"}
          Start = days the optimizer can fit them into a starting slot given position constraints.{"\n"}
          Orange = benched days due to slot conflicts.
        </Text>
      </View>
    </ScrollView>
  );
}

function WeekCell({ raw, play }: { raw: number; play: number }) {
  const benched = raw - play;
  return (
    <View style={styles.weekCell}>
      <Text style={styles.weekRaw}>{raw}</Text>
      {benched > 0 && <Text style={styles.weekBenched}>-{benched}</Text>}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Grid view — player × day matrix
// ---------------------------------------------------------------------------
function GridView({
  data,
  week,
  setWeek,
}: {
  data: PlayerGridRow[];
  week: "21" | "22" | "23" | "all";
  setWeek: (w: "21" | "22" | "23" | "all") => void;
}) {
  const { width: screenWidth } = useWindowDimensions();

  const allDays = useMemo(() => {
    if (!data[0]) return [];
    return data[0].days.filter((d) => week === "all" || String(d.week_num) === week);
  }, [data, week]);

  // Dynamic column widths — min 36px so individual weeks fill screen, "all" scrolls horizontally
  const NAME_COL = 90;
  const TOT_COL = 32;
  const H_PAD = 32;
  const DAY_COL = Math.max(36, Math.floor((screenWidth - H_PAD - NAME_COL - TOT_COL) / (allDays.length || 1)));

  // Abbreviate day label: "Mon 3/16" → "M\n3/16"
  const shortLabel = (label: string) => {
    const [day, date] = label.split(" ");
    return `${day[0]}\n${date ?? ""}`;
  };

  return (
    <ScrollView style={styles.flex1} contentContainerStyle={{ paddingBottom: 20 }}>
      <View style={styles.weekTabRow}>
        <SegmentedButtons
          value={week}
          onValueChange={(v) => setWeek(v as typeof week)}
          buttons={[
            { value: "21", label: "Wk 21" },
            { value: "22", label: "Wk 22" },
            { value: "23", label: "Wk 23" },
            { value: "all", label: "All" },
          ]}
        />
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.gridScrollH}>
      <View style={styles.gridSurface}>
        {/* Header row */}
        <View style={[styles.gridRow, styles.gridHeader]}>
          <View style={[styles.gridNameCell, { width: NAME_COL }]}>
            <Text style={styles.gridHeaderText}>Player</Text>
          </View>
          {allDays.map((d) => (
            <View key={d.date} style={[styles.gridDayCell, { width: DAY_COL }]}>
              <Text style={[styles.gridHeaderText, { fontSize: 9, textAlign: "center" }]} numberOfLines={2}>
                {shortLabel(d.day_label)}
              </Text>
            </View>
          ))}
          <View style={[styles.gridDayCell, { width: TOT_COL }]}>
            <Text style={styles.gridHeaderText}>G</Text>
          </View>
        </View>

        {/* Player rows */}
        {data.map((row, idx) => {
          const filteredDays = row.days.filter((d) => week === "all" || String(d.week_num) === week);
          const total = filteredDays.filter((d) => d.has_game).length;
          return (
            <View key={row.player} style={[styles.gridRow, idx % 2 === 1 && styles.gridRowAlt]}>
              <View style={[styles.gridNameCell, { width: NAME_COL }]}>
                <Text style={styles.gridName} numberOfLines={1}>{row.player.split(" ").pop()}</Text>
                <Text style={styles.gridTeam}>{row.team}</Text>
              </View>
              {filteredDays.map((d) => (
                <View key={d.date} style={[styles.gridDayCell, { width: DAY_COL }]}>
                  {d.has_game && (
                    <View style={[styles.gameDot, d.is_starting ? styles.gameDotStart : styles.gameDotBench]} />
                  )}
                </View>
              ))}
              <View style={[styles.gridDayCell, { width: TOT_COL }]}>
                <Text style={styles.gridTotalText}>{total}</Text>
              </View>
            </View>
          );
        })}
      </View>
      </ScrollView>

      <View style={styles.gridLegend}>
        <View style={[styles.gameDot, styles.gameDotStart, { width: 12, height: 12 }]} />
        <Text style={styles.gridLegendItem}>Starting</Text>
        <View style={[styles.gameDot, styles.gameDotBench, { width: 12, height: 12, marginLeft: 16 }]} />
        <Text style={[styles.gridLegendItem, { color: "#e65100" }]}>Benched</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex1: { flex: 1 },
  summaryTable: { minWidth: 380 },
  title: { fontSize: 22, fontWeight: "700", marginTop: 16, marginHorizontal: 16 },
  subtitle: { fontSize: 13, marginHorizontal: 16, marginBottom: 4 },
  controls: { marginHorizontal: 16, marginVertical: 10 },
  emptyText: { color: "#888", textAlign: "center", margin: 32, fontSize: 14 },

  // Summary
  nameCol: { flex: 2.2 },
  numCol: { flex: 0.9 },
  playerName: { fontWeight: "600", fontSize: 13 },
  playerMeta: { fontSize: 10, color: "#888" },
  boldNum: { fontWeight: "700", fontSize: 14 },
  totalsRow: { backgroundColor: "#f5f5f5" },
  totalsLabel: { fontWeight: "800", fontSize: 13 },
  totalsNum: { fontWeight: "800", fontSize: 14 },
  weekCell: { alignItems: "flex-end" },
  weekRaw: { fontWeight: "600", fontSize: 13 },
  weekBenched: { fontSize: 10, color: "#e65100" },
  legend: { margin: 16, padding: 12, backgroundColor: "#f9f9f9", borderRadius: 8 },
  legendTitle: { fontWeight: "700", marginBottom: 6 },
  legendText: { fontSize: 12, color: "#555", lineHeight: 18 },

  // Grid
  weekTabRow: { marginHorizontal: 12, marginVertical: 10 },
  gridScrollH: { marginHorizontal: 16 },
  gridSurface: { borderRadius: 14, overflow: "hidden", backgroundColor: "#fff", elevation: 1 },
  gridRow: { flexDirection: "row", alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#efefef" },
  gridRowAlt: { backgroundColor: "#fafafa" },
  gridHeader: { backgroundColor: "#6750a4" },
  gridHeaderText: { color: "#fff", fontWeight: "700", fontSize: 10 },
  gridNameCell: { paddingVertical: 8, paddingHorizontal: 6, justifyContent: "center", borderRightWidth: 1, borderRightColor: "rgba(0,0,0,0.06)" },
  gridName: { fontWeight: "600", fontSize: 11, color: "#1a1a1a" },
  gridTeam: { fontSize: 9, color: "#888" },
  gridDayCell: { alignItems: "center", justifyContent: "center", paddingVertical: 8, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: "#efefef" },
  gridTotalText: { fontWeight: "800", fontSize: 12, color: "#6750a4" },
  gameDot: { width: 10, height: 10, borderRadius: 5 },
  gameDotStart: { backgroundColor: "#2e7d32" },
  gameDotBench: { backgroundColor: "#e65100" },
  gridLegend: { flexDirection: "row", alignItems: "center", justifyContent: "center", padding: 12, gap: 6 },
  gridLegendItem: { fontSize: 12, color: "#2e7d32", fontWeight: "600" },
});
