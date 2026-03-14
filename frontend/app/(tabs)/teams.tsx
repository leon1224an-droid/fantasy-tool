import React, { useMemo, useState } from "react";
import { ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import { Chip, DataTable, SegmentedButtons, Text, useTheme } from "react-native-paper";
import { useQuery } from "@tanstack/react-query";
import { getAllSchedule, getTeamDays } from "../../lib/api";
import { LoadingOrError } from "../../components/LoadingOrError";

type ViewMode = "summary" | "grid";
type WeekFilter = "21" | "22" | "23" | "all";
function gamesColor(n: number): string {
  if (n >= 4) return "#2e7d32";
  if (n === 3) return "#1565c0";
  if (n > 0) return "#c62828";
  return "#bdbdbd";
}

function dayAbbrev(label: string): string {
  return label.split(" ")[0]; // "Mon 3/16" → "Mon"
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------
export default function TeamsScreen() {
  const theme = useTheme();
  const [viewMode, setViewMode] = useState<ViewMode>("summary");
  const [week, setWeek] = useState<WeekFilter>("all");
  const [minGames, setMinGames] = useState(0);
  const [dateFilter, setDateFilter] = useState<Set<string>>(new Set());

  const { data: scheduleData, isLoading: schedLoading, error: schedError, refetch } = useQuery({
    queryKey: ["schedule-all"],
    queryFn: getAllSchedule,
  });

  const { data: teamDays, isLoading: daysLoading } = useQuery({
    queryKey: ["team-days"],
    queryFn: getTeamDays,
  });

  const isLoading = schedLoading || daysLoading;

  // {team: {weekNum: Set<dateStr>}}
  const teamDayMap = useMemo(() => {
    const map: Record<string, Record<number, Set<string>>> = {};
    for (const row of teamDays ?? []) {
      if (!map[row.team]) map[row.team] = {};
      if (!map[row.team][row.week_num]) map[row.team][row.week_num] = new Set();
      map[row.team][row.week_num].add(row.date);
    }
    return map;
  }, [teamDays]);

  // Build team summary rows
  const teamRows = useMemo(() => {
    if (!scheduleData) return [];
    const map: Record<string, { team: string; w21: number; w22: number; w23: number; total: number }> = {};
    for (const row of scheduleData) {
      if (!map[row.team]) map[row.team] = { team: row.team, w21: 0, w22: 0, w23: 0, total: 0 };
      (map[row.team] as Record<string, number>)[`w${row.week_num}`] = row.games_count;
      map[row.team].total += row.games_count;
    }
    return Object.values(map).sort((a, b) => b.total - a.total);
  }, [scheduleData]);

  // Ordered game dates from teamDays data
  const allDates = useMemo(() => {
    const seen = new Map<string, { label: string; weekNum: number }>();
    for (const row of teamDays ?? []) {
      if (!seen.has(row.date)) seen.set(row.date, { label: row.day_label, weekNum: row.week_num });
    }
    return [...seen.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, { label, weekNum }]) => ({ date, label, weekNum }));
  }, [teamDays]);

  const gridDates = useMemo(
    () => week === "all" ? allDates : allDates.filter((d) => String(d.weekNum) === week),
    [allDates, week]
  );

  // Helper: get week-specific game count for a team row
  const weekGames = (row: { w21: number; w22: number; w23: number; total: number }, w: WeekFilter): number => {
    if (w === "all") return row.total;
    return (row as Record<string, number>)[`w${w}`] ?? 0;
  };

  const handleSetWeek = (w: WeekFilter) => {
    if (w === "all") setMinGames(0);
    setWeek(w);
  };

  const toggleDate = (d: string) => setDateFilter((prev) => {
    const next = new Set(prev);
    next.has(d) ? next.delete(d) : next.add(d);
    return next;
  });

  // Dates grouped by week for the filter UI
  const datesByWeek = useMemo(() => {
    const groups: Record<number, typeof allDates> = { 21: [], 22: [], 23: [] };
    for (const d of allDates) {
      groups[d.weekNum]?.push(d);
    }
    return groups;
  }, [allDates]);

  // Filtered + sorted rows (applies to both views)
  const displayRows = useMemo(() => {
    return teamRows.filter((row) => {
      const games = weekGames(row, week);
      if (minGames > 0 && games < minGames) return false;
      if (dateFilter.size > 0) {
        const gameDates = new Set<string>();
        for (const wn of [21, 22, 23]) {
          for (const d of teamDayMap[row.team]?.[wn] ?? new Set()) {
            gameDates.add(d);
          }
        }
        for (const d of dateFilter) {
          if (!gameDates.has(d)) return false;
        }
      }
      return true;
    });
  }, [teamRows, week, minGames, dateFilter, teamDayMap]);

  return (
    <ScrollView style={[styles.container, { backgroundColor: theme.colors.background }]} contentContainerStyle={styles.scrollContent}>
      <Text style={[styles.title, { color: theme.colors.onBackground }]}>Team Schedules</Text>
      <Text style={[styles.subtitle, { color: theme.colors.onSurfaceVariant }]}>
        Games per team across the 3-week playoff
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

      {/* Filters */}
      <View style={styles.filterRow}>
        {/* Week (summary only — grid has its own week tabs) */}
        {viewMode === "summary" && (
          <View style={styles.filterGroup}>
            <Text style={styles.filterLabel}>Week</Text>
            <View style={styles.chipRow}>
              {(["all", "21", "22", "23"] as WeekFilter[]).map((w) => (
                <Chip key={w} selected={week === w} onPress={() => handleSetWeek(w)} compact showSelectedOverlay style={styles.chip} textStyle={styles.chipText}>
                  {w === "all" ? "All" : `Wk ${w}`}
                </Chip>
              ))}
            </View>
          </View>
        )}

        {/* Min games — only meaningful on a per-week basis */}
        {week !== "all" && (
          <View style={styles.filterGroup}>
            <Text style={styles.filterLabel}>Min games (Wk {week})</Text>
            <View style={styles.chipRow}>
              {[0, 2, 3, 4].map((n) => (
                <Chip key={n} selected={minGames === n} onPress={() => setMinGames(n)} compact showSelectedOverlay style={styles.chip} textStyle={styles.chipText}>
                  {n === 0 ? "Any" : `${n}+`}
                </Chip>
              ))}
            </View>
          </View>
        )}

        {/* Must play on — specific dates grouped by week */}
        {allDates.length > 0 && (
          <View style={styles.filterGroup}>
            <View style={styles.filterLabelRow}>
              <Text style={styles.filterLabel}>Must play on</Text>
              {dateFilter.size > 0 && (
                <Chip compact onPress={() => setDateFilter(new Set())} style={styles.clearChip} textStyle={styles.chipText}>
                  Clear ({dateFilter.size})
                </Chip>
              )}
            </View>
            {([21, 22, 23] as const).map((wk) => {
              const wkDates = datesByWeek[wk];
              if (!wkDates || wkDates.length === 0) return null;
              return (
                <View key={wk} style={styles.dateWeekRow}>
                  <Text style={styles.dateWeekLabel}>Wk {wk}</Text>
                  <View style={styles.chipRow}>
                    {wkDates.map(({ date, label }) => (
                      <Chip
                        key={date}
                        selected={dateFilter.has(date)}
                        onPress={() => toggleDate(date)}
                        compact
                        showSelectedOverlay
                        style={styles.chip}
                        textStyle={styles.chipText}
                      >
                        {dayAbbrev(label)}
                      </Chip>
                    ))}
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </View>

      <Text style={styles.resultCount}>{displayRows.length} teams</Text>

      {(isLoading || schedError) && (
        <LoadingOrError loading={isLoading} error={schedError as Error | null} onRetry={refetch} />
      )}

      {!isLoading && !schedError && (
        <>
          {viewMode === "summary" && <SummaryView rows={displayRows} week={week} />}
          {viewMode === "grid" && (
            <GridView
              rows={displayRows}
              teamDayMap={teamDayMap}
              dates={gridDates}
              week={week}
              setWeek={handleSetWeek}
            />
          )}
        </>
      )}
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Summary view
// ---------------------------------------------------------------------------
function SummaryView({
  rows,
  week,
}: {
  rows: { team: string; w21: number; w22: number; w23: number; total: number }[];
  week: WeekFilter;
}) {
  return (
    <View>
      <DataTable>
        <DataTable.Header>
          <DataTable.Title style={styles.teamCol}>Team</DataTable.Title>
          <DataTable.Title numeric style={styles.numCol}>W21</DataTable.Title>
          <DataTable.Title numeric style={styles.numCol}>W22</DataTable.Title>
          <DataTable.Title numeric style={styles.numCol}>W23</DataTable.Title>
          <DataTable.Title numeric style={styles.numCol}>Total</DataTable.Title>
        </DataTable.Header>

        {rows.map((row) => (
          <DataTable.Row key={row.team}>
            <DataTable.Cell style={styles.teamCol}>
              <Text style={[styles.teamName, week !== "all" && { color: gamesColor((row as Record<string, number>)[`w${week}`] ?? 0) }]}>
                {row.team}
              </Text>
            </DataTable.Cell>
            {([21, 22, 23] as const).map((w) => {
              const n = (row as Record<string, number>)[`w${w}`] ?? 0;
              return (
                <DataTable.Cell numeric style={styles.numCol} key={w}>
                  <Text style={[styles.gameNum, { color: gamesColor(n) }]}>{n}</Text>
                </DataTable.Cell>
              );
            })}
            <DataTable.Cell numeric style={styles.numCol}>
              <Text style={[styles.totalNum, { color: gamesColor(row.total / 3) }]}>{row.total}</Text>
            </DataTable.Cell>
          </DataTable.Row>
        ))}
      </DataTable>

      <View style={styles.legend}>
        {[{ n: 4, label: "4+ games" }, { n: 3, label: "3 games" }, { n: 2, label: "≤2 games" }].map(({ n, label }) => (
          <View key={n} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: gamesColor(n) }]} />
            <Text style={styles.legendText}>{label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Grid view — team × date matrix
// ---------------------------------------------------------------------------
function GridView({
  rows,
  teamDayMap,
  dates,
  week,
  setWeek,
}: {
  rows: { team: string; w21: number; w22: number; w23: number; total: number }[];
  teamDayMap: Record<string, Record<number, Set<string>>>;
  dates: { date: string; label: string; weekNum: number }[];
  week: WeekFilter;
  setWeek: (w: WeekFilter) => void;
}) {
  const { width: screenWidth } = useWindowDimensions();
  const TEAM_COL = 48;
  const TOT_COL = 28;
  const OUTER_PADDING = 32; // 16px each side
  const MIN_DAY_COL = 28;
  const availableForDays = screenWidth - OUTER_PADDING - TEAM_COL - TOT_COL;
  const DAY_COL = dates.length > 0
    ? Math.max(MIN_DAY_COL, Math.floor(availableForDays / dates.length))
    : MIN_DAY_COL;
  const totalWidth = TEAM_COL + dates.length * DAY_COL + TOT_COL;

  const shortLabel = (label: string) => {
    const [day, date] = label.split(" ");
    return `${day[0]}\n${date ?? ""}`;
  };

  return (
    <View>
      <View style={styles.weekTabRow}>
        <SegmentedButtons
          value={week}
          onValueChange={(v) => setWeek(v as WeekFilter)}
          buttons={[
            { value: "21", label: "Wk 21" },
            { value: "22", label: "Wk 22" },
            { value: "23", label: "Wk 23" },
            { value: "all", label: "All" },
          ]}
        />
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.gridScrollView}>
        <View style={[styles.gridSurface, { width: totalWidth }]}>
            {/* Header */}
            <View style={[styles.gridRow, styles.gridHeader]}>
              <View style={[styles.gridTeamCell, { width: TEAM_COL }]}>
                <Text style={styles.gridHeaderText}>Team</Text>
              </View>
              {dates.map(({ date, label }) => (
                <View key={date} style={[styles.gridDayCell, { width: DAY_COL }]}>
                  <Text style={[styles.gridHeaderText, { textAlign: "center", fontSize: 9 }]} numberOfLines={2}>
                    {shortLabel(label)}
                  </Text>
                </View>
              ))}
              <View style={[styles.gridDayCell, { width: TOT_COL }]}>
                <Text style={styles.gridHeaderText}>G</Text>
              </View>
            </View>

            {/* Team rows */}
            {rows.map((row, idx) => {
              // Collect all game dates for this team across all weeks
              const gameDates = new Set<string>();
              for (const wk of [21, 22, 23]) {
                for (const d of Array.from(teamDayMap[row.team]?.[wk] ?? new Set())) {
                  gameDates.add(d);
                }
              }
              const total = dates.filter((d) => gameDates.has(d.date)).length;
              const colorN = week === "all" ? total / 3 : total;

              return (
                <View key={row.team} style={[styles.gridRow, idx % 2 === 1 && styles.gridRowAlt]}>
                  <View style={[styles.gridTeamCell, { width: TEAM_COL }]}>
                    <Text style={styles.gridTeamText}>{row.team}</Text>
                    <Text style={[styles.gridGamesCount, { color: gamesColor(colorN) }]}>{total}G</Text>
                  </View>
                  {dates.map(({ date }) => (
                    <View key={date} style={[styles.gridDayCell, { width: DAY_COL }]}>
                      {gameDates.has(date) && (
                        <View style={[styles.gameDot, { backgroundColor: gamesColor(colorN) }]} />
                      )}
                    </View>
                  ))}
                  <View style={[styles.gridDayCell, { width: TOT_COL }]}>
                    <Text style={[styles.gridTotalText, { color: gamesColor(colorN) }]}>{total}</Text>
                  </View>
                </View>
              );
            })}
        </View>
      </ScrollView>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { paddingBottom: 40 },
  title: { fontSize: 18, fontWeight: "700", marginTop: 12, marginHorizontal: 16 },
  subtitle: { fontSize: 12, marginHorizontal: 16, marginBottom: 4, color: "#888" },
  controls: { marginHorizontal: 16, marginVertical: 10 },

  // Filters
  filterRow: { marginHorizontal: 16, gap: 10, marginBottom: 6 },
  filterGroup: { gap: 6 },
  filterLabelRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  filterLabel: { fontSize: 11, fontWeight: "700", color: "#555", textTransform: "uppercase", letterSpacing: 0.4 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { height: 28 },
  chipText: { fontSize: 11 },
  clearChip: { height: 28, backgroundColor: "#ffebee" },
  dateWeekRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  dateWeekLabel: { fontSize: 10, fontWeight: "700", color: "#6750a4", width: 32, textTransform: "uppercase" },
  resultCount: { fontSize: 12, color: "#999", textAlign: "right", marginHorizontal: 16, marginBottom: 4 },

  // Summary
  teamCol: { flex: 2 },
  numCol: { flex: 1 },
  teamName: { fontWeight: "600", fontSize: 13 },
  gameNum: { fontWeight: "700", fontSize: 14 },
  totalNum: { fontWeight: "800", fontSize: 15 },
  legend: { flexDirection: "row", justifyContent: "center", gap: 20, padding: 16 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { fontSize: 12, color: "#666" },

  // Grid
  weekTabRow: { marginHorizontal: 12, marginVertical: 10 },
  gridScrollView: { marginHorizontal: 16 },
  gridSurface: { borderRadius: 14, overflow: "hidden", backgroundColor: "#fff", elevation: 1 },
  gridRow: { flexDirection: "row", alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#efefef" },
  gridRowAlt: { backgroundColor: "#fafafa" },
  gridHeader: { backgroundColor: "#6750a4" },
  gridHeaderText: { color: "#fff", fontWeight: "700", fontSize: 10 },
  gridTeamCell: { paddingVertical: 8, paddingHorizontal: 4, justifyContent: "center", alignItems: "center", borderRightWidth: 1, borderRightColor: "rgba(0,0,0,0.06)" },
  gridTeamText: { fontSize: 11, fontWeight: "700", color: "#1a1a1a" },
  gridGamesCount: { fontSize: 9, fontWeight: "700", marginTop: 1 },
  gridDayCell: { alignItems: "center", justifyContent: "center", paddingVertical: 8, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: "#efefef" },
  gridTotalText: { fontWeight: "800", fontSize: 12 },
  gameDot: { width: 10, height: 10, borderRadius: 5 },
});
