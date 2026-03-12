import React, { useMemo, useState } from "react";
import { ScrollView, StyleSheet, TouchableOpacity, useWindowDimensions, View } from "react-native";
import { Chip, Surface, Text, useTheme } from "react-native-paper";
import { useQuery } from "@tanstack/react-query";
import { getAllSchedule, getTeamDays, ScheduleRow, TeamDayRow } from "../../lib/api";
import { LoadingOrError } from "../../components/LoadingOrError";
import { WeekSelector } from "../../components/WeekSelector";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
type Day = typeof DAYS[number];

type SortKey = "team" | "w21" | "w22" | "w23" | "total";

function dayOfWeek(dateStr: string): Day {
  const d = new Date(dateStr + "T12:00:00");
  return (["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const)[d.getDay()] as Day;
}

function gamesColor(n: number): string {
  if (n >= 4) return "#2e7d32";
  if (n === 3) return "#1565c0";
  if (n > 0) return "#c62828";
  return "#bdbdbd";
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------
export default function TeamsScreen() {
  const theme = useTheme();
  const { width: screenWidth } = useWindowDimensions();

  const [week, setWeek] = useState<number>(21);
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const [minGames, setMinGames] = useState(0);
  const [dayFilter, setDayFilter] = useState<Set<Day>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>("total");
  const [sortAsc, setSortAsc] = useState(false);

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

  // Ordered dates for the selected week
  const weekDates = useMemo(() => {
    const seen = new Map<string, string>(); // date -> day_label
    for (const row of teamDays ?? []) {
      if (row.week_num === week && !seen.has(row.date)) seen.set(row.date, row.day_label);
    }
    return [...seen.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, label]) => ({ date, label }));
  }, [teamDays, week]);

  // Toggle day filter
  const toggleDay = (d: Day) => setDayFilter((prev) => {
    const next = new Set(prev);
    next.has(d) ? next.delete(d) : next.add(d);
    return next;
  });

  // Build team rows from schedule data
  const allTeamRows = useMemo(() => {
    if (!scheduleData) return [];
    const map: Record<string, { team: string; w21: number; w22: number; w23: number; total: number }> = {};
    for (const row of scheduleData) {
      if (!map[row.team]) map[row.team] = { team: row.team, w21: 0, w22: 0, w23: 0, total: 0 };
      (map[row.team] as Record<string, number>)[`w${row.week_num}`] = row.games_count;
      map[row.team].total += row.games_count;
    }
    return Object.values(map);
  }, [scheduleData]);

  // Apply filters
  const filteredRows = useMemo(() => {
    return allTeamRows.filter((row) => {
      const games = (row as Record<string, number>)[`w${week}`] ?? 0;
      if (minGames > 0 && games < minGames) return false;
      if (dayFilter.size > 0) {
        const gameDates = teamDayMap[row.team]?.[week] ?? new Set();
        const playedDays = new Set([...gameDates].map(dayOfWeek));
        for (const d of dayFilter) {
          if (!playedDays.has(d)) return false;
        }
      }
      return true;
    }).sort((a, b) => {
      const av = (a as Record<string, number | string>)[sortKey];
      const bv = (b as Record<string, number | string>)[sortKey];
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortAsc ? cmp : -cmp;
    });
  }, [allTeamRows, week, minGames, dayFilter, teamDayMap, sortKey, sortAsc]);

  const handleSort = (key: SortKey) => {
    if (key === sortKey) setSortAsc((v) => !v);
    else { setSortKey(key); setSortAsc(key === "team"); }
  };

  // Grid column widths
  const TEAM_COL = 52;
  const H_PAD = 32;
  const numCols = weekDates.length || 7;
  const DAY_COL = Math.max(44, Math.floor((screenWidth - H_PAD - TEAM_COL) / numCols));

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {(isLoading || schedError) && (
        <LoadingOrError loading={isLoading} error={schedError as Error | null} onRetry={refetch} />
      )}

      {!isLoading && !schedError && (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {/* Week selector */}
          <WeekSelector value={week} onChange={setWeek} />

          {/* View toggle */}
          <View style={styles.viewToggleRow}>
            <TouchableOpacity
              style={[styles.toggleBtn, viewMode === "list" && styles.toggleBtnActive]}
              onPress={() => setViewMode("list")}
              activeOpacity={0.7}
            >
              <Text style={[styles.toggleBtnText, viewMode === "list" && styles.toggleBtnTextActive]}>List</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.toggleBtn, viewMode === "grid" && styles.toggleBtnActive]}
              onPress={() => setViewMode("grid")}
              activeOpacity={0.7}
            >
              <Text style={[styles.toggleBtnText, viewMode === "grid" && styles.toggleBtnTextActive]}>Game Days</Text>
            </TouchableOpacity>
          </View>

          {/* Filters */}
          <Surface style={styles.filterCard} elevation={0}>
            <Text style={styles.filterLabel}>Min games (Wk {week})</Text>
            <View style={styles.chipRow}>
              {[0, 2, 3, 4, 5].map((n) => (
                <Chip
                  key={n}
                  selected={minGames === n}
                  onPress={() => setMinGames(n)}
                  compact
                  showSelectedOverlay
                  style={styles.chip}
                  textStyle={styles.chipText}
                >
                  {n === 0 ? "Any" : `${n}+`}
                </Chip>
              ))}
            </View>

            <Text style={[styles.filterLabel, { marginTop: 10 }]}>Must play on</Text>
            <View style={styles.chipRow}>
              {DAYS.map((d) => (
                <Chip
                  key={d}
                  selected={dayFilter.has(d)}
                  onPress={() => toggleDay(d)}
                  compact
                  showSelectedOverlay
                  style={styles.chip}
                  textStyle={styles.chipText}
                >
                  {d}
                </Chip>
              ))}
              {dayFilter.size > 0 && (
                <Chip compact onPress={() => setDayFilter(new Set())} style={styles.clearChip} textStyle={styles.chipText}>
                  Clear
                </Chip>
              )}
            </View>
          </Surface>

          <Text style={styles.resultCount}>{filteredRows.length} teams</Text>

          {/* List view */}
          {viewMode === "list" && (
            <Surface style={styles.surface} elevation={1}>
              <View style={styles.tableHeader}>
                {(["team", "w21", "w22", "w23", "total"] as SortKey[]).map((col) => {
                  const label = col === "team" ? "Team" : col === "total" ? "Total" : `Wk ${col.slice(1)}`;
                  const active = sortKey === col;
                  const arrow = active ? (sortAsc ? " ↑" : " ↓") : "";
                  return (
                    <TouchableOpacity
                      key={col}
                      onPress={() => handleSort(col)}
                      activeOpacity={0.6}
                      style={col === "team" ? styles.teamColW : styles.weekColW}
                    >
                      <Text style={[styles.colLabel, active && styles.colLabelActive]}>{label}{arrow}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {filteredRows.map((row, idx) => (
                <View key={row.team} style={[styles.tableRow, idx % 2 === 1 && styles.tableRowAlt]}>
                  <Text style={[styles.teamText, styles.teamColW]}>{row.team}</Text>
                  {([21, 22, 23] as const).map((w) => {
                    const n = (row as Record<string, number>)[`w${w}`] ?? 0;
                    return (
                      <View key={w} style={styles.weekColW}>
                        <View style={[styles.badge, { backgroundColor: gamesColor(n) + "20" }]}>
                          <Text style={[styles.badgeText, { color: gamesColor(n) }]}>{n}</Text>
                        </View>
                      </View>
                    );
                  })}
                  <View style={styles.weekColW}>
                    <Text style={[styles.totalText, { color: gamesColor(row.total / 3) }]}>{row.total}</Text>
                  </View>
                </View>
              ))}
            </Surface>
          )}

          {/* Grid view */}
          {viewMode === "grid" && (
            <Surface style={styles.surface} elevation={1}>
              {/* Header row */}
              <View style={styles.gridHeaderRow}>
                <View style={[styles.gridTeamCell, { width: TEAM_COL }]}>
                  <Text style={styles.colLabel}>Team</Text>
                </View>
                {weekDates.map(({ date, label }) => {
                  const parts = label.split(" ");
                  const isFiltered = dayFilter.has(dayOfWeek(date));
                  return (
                    <View key={date} style={[styles.gridDayHeader, { width: DAY_COL }, isFiltered && styles.gridDayHeaderFiltered]}>
                      <Text style={styles.gridDayName}>{parts[0]}</Text>
                      <Text style={styles.gridDayDate}>{parts.slice(1).join(" ")}</Text>
                    </View>
                  );
                })}
              </View>

              {/* Team rows */}
              {filteredRows.map((row, idx) => {
                const gameDates = teamDayMap[row.team]?.[week] ?? new Set<string>();
                const weekGames = gameDates.size;
                return (
                  <View key={row.team} style={[styles.gridRow, idx % 2 === 1 && styles.tableRowAlt]}>
                    <View style={[styles.gridTeamCell, { width: TEAM_COL }]}>
                      <Text style={styles.gridTeamText}>{row.team}</Text>
                      <Text style={[styles.gridGamesCount, { color: gamesColor(weekGames) }]}>{weekGames}G</Text>
                    </View>
                    {weekDates.map(({ date }) => {
                      const plays = gameDates.has(date);
                      return (
                        <View key={date} style={[styles.gridDayCell, { width: DAY_COL }]}>
                          {plays && (
                            <View style={[styles.gameDot, { backgroundColor: gamesColor(weekGames) }]} />
                          )}
                        </View>
                      );
                    })}
                  </View>
                );
              })}
            </Surface>
          )}

          {/* Legend */}
          <View style={styles.legend}>
            {[{ n: 4, label: "4 games" }, { n: 3, label: "3 games" }, { n: 2, label: "≤2 games" }].map(({ n, label }) => (
              <View key={n} style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: gamesColor(n) }]} />
                <Text style={styles.legendText}>{label}</Text>
              </View>
            ))}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { padding: 16, paddingBottom: 40, gap: 12 },

  // View toggle
  viewToggleRow: { flexDirection: "row", backgroundColor: "#f0edf8", borderRadius: 10, padding: 3, alignSelf: "center" },
  toggleBtn: { paddingHorizontal: 20, paddingVertical: 7, borderRadius: 8 },
  toggleBtnActive: { backgroundColor: "#fff", shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 4, elevation: 2 },
  toggleBtnText: { fontSize: 13, fontWeight: "600", color: "#888" },
  toggleBtnTextActive: { color: "#6750a4" },

  // Filters
  filterCard: { borderRadius: 14, backgroundColor: "#fff", padding: 14 },
  filterLabel: { fontSize: 12, fontWeight: "700", color: "#555", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.4 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { height: 30 },
  chipText: { fontSize: 12 },
  clearChip: { height: 30, backgroundColor: "#ffebee" },

  resultCount: { fontSize: 12, color: "#999", textAlign: "right" },

  surface: { borderRadius: 16, backgroundColor: "#fff", overflow: "hidden" },

  // List view
  tableHeader: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 16, paddingVertical: 10,
    backgroundColor: "#6750a4",
  },
  colLabel: { fontSize: 11, fontWeight: "700", color: "rgba(255,255,255,0.75)", textTransform: "uppercase", letterSpacing: 0.4, textAlign: "center" },
  colLabelActive: { color: "#fff" },
  tableRow: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 16, paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#f0f0f0",
    minHeight: 44,
  },
  tableRowAlt: { backgroundColor: "#fafafa" },
  teamColW: { width: 52 },
  weekColW: { flex: 1, alignItems: "center" },
  teamText: { fontSize: 13, fontWeight: "700", color: "#1a1a1a" },
  totalText: { fontSize: 15, fontWeight: "800" },
  badge: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, alignSelf: "center" },
  badgeText: { fontSize: 14, fontWeight: "700" },

  // Grid view
  gridHeaderRow: {
    flexDirection: "row",
    backgroundColor: "#6750a4",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.2)",
  },
  gridTeamCell: {
    justifyContent: "center", alignItems: "center",
    paddingVertical: 10,
    borderRightWidth: 1, borderRightColor: "rgba(255,255,255,0.2)",
  },
  gridDayHeader: {
    alignItems: "center", justifyContent: "center",
    paddingVertical: 8,
    borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: "rgba(255,255,255,0.2)",
  },
  gridDayHeaderFiltered: { backgroundColor: "rgba(255,255,255,0.15)" },
  gridDayName: { color: "#fff", fontWeight: "700", fontSize: 11 },
  gridDayDate: { color: "rgba(255,255,255,0.75)", fontSize: 9, marginTop: 1 },
  gridRow: {
    flexDirection: "row",
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#f0f0f0",
    minHeight: 38,
  },
  gridTeamText: { fontSize: 11, fontWeight: "700", color: "#1a1a1a" },
  gridGamesCount: { fontSize: 9, fontWeight: "700", marginTop: 1 },
  gridDayCell: {
    justifyContent: "center", alignItems: "center",
    borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: "#f0f0f0",
  },
  gameDot: { width: 10, height: 10, borderRadius: 5 },

  // Legend
  legend: { flexDirection: "row", justifyContent: "center", gap: 20 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { fontSize: 12, color: "#666" },
});
