import React, { useState, useMemo } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { Text, useTheme } from "react-native-paper";
import { useQuery } from "@tanstack/react-query";
import { getCalendar, WeeklyCalendarResponse, DailyLineupResponse } from "../../lib/api";
import { WeekSelector } from "../../components/WeekSelector";
import { LoadingOrError } from "../../components/LoadingOrError";

const SLOT_ORDER = ["PG", "SG", "G", "SF", "PF", "F", "C1", "C2", "UTIL1", "UTIL2"];

// Column widths
const SLOT_COL_W = 56;
const DAY_COL_W = 72;

export default function CalendarScreen() {
  const theme = useTheme();
  const [week, setWeek] = useState(21);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["calendar"],
    queryFn: getCalendar,
  });

  const weekData = data?.find((w) => w.week_num === week);

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Text style={[styles.title, { color: theme.colors.onBackground }]}>
        Daily Calendar
      </Text>
      <Text style={[styles.subtitle, { color: theme.colors.onSurfaceVariant }]}>
        Greedy slot optimizer — who starts each day
      </Text>

      <WeekSelector value={week} onChange={setWeek} />

      {(isLoading || error) && (
        <LoadingOrError loading={isLoading} error={error as Error | null} onRetry={refetch} />
      )}

      {weekData && <WeekTable weekData={weekData} />}

      {!isLoading && !error && !weekData && (
        <Text style={styles.emptyText}>
          No schedule data. Run "Refresh Data" on the Dashboard first.
        </Text>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Horizontal week table: rows = slots, columns = days
// ---------------------------------------------------------------------------
function WeekTable({ weekData }: { weekData: WeeklyCalendarResponse }) {
  const theme = useTheme();
  const days = weekData.days;

  // For each slot × day, find the assigned player
  const getCellPlayer = (day: DailyLineupResponse, slot: string): string | null => {
    if (day.players_available === 0) return null;
    return day.lineup.find((l) => l.slot === slot)?.player ?? null;
  };

  // Benched players per day (flatten all benched from day.benched)
  const getBenched = (day: DailyLineupResponse): string[] => day.benched;

  // Total games per day = day.players_available
  const getTotal = (day: DailyLineupResponse): number => day.players_available;

  // Header bg based on game count
  const dayHeaderBg = (day: DailyLineupResponse) => {
    const n = day.players_available;
    if (n === 0) return "#9e9e9e";
    if (n >= 4) return "#2e7d32";
    if (n === 3) return "#1565c0";
    if (n === 2) return "#e65100";
    return "#6750a4";
  };

  return (
    <ScrollView contentContainerStyle={styles.scrollOuter}>
      <ScrollView horizontal showsHorizontalScrollIndicator>
        <View>
          {/* ---- Day header row ---- */}
          <View style={[styles.row, styles.headerRow]}>
            {/* slot label corner */}
            <View style={[styles.slotCell, styles.cornerCell]}>
              <Text style={styles.cornerText}>Slot</Text>
            </View>

            {days.map((day) => {
              const bg = dayHeaderBg(day);
              const [dayName, dayDate] = day.day_label.includes(" ")
                ? day.day_label.split(" ")
                : [day.day_label, ""];
              return (
                <View key={day.date} style={[styles.dayHeaderCell, { backgroundColor: bg }]}>
                  <Text style={styles.dayHeaderName}>{dayName}</Text>
                  {dayDate ? <Text style={styles.dayHeaderDate}>{dayDate}</Text> : null}
                  <Text style={styles.dayHeaderGames}>
                    {day.players_available > 0 ? `${day.players_available}G` : "—"}
                  </Text>
                </View>
              );
            })}
          </View>

          {/* ---- Slot rows ---- */}
          {SLOT_ORDER.map((slot, idx) => (
            <View key={slot} style={[styles.row, idx % 2 === 1 && styles.rowAlt]}>
              {/* slot label */}
              <View style={styles.slotCell}>
                <Text style={styles.slotLabel}>{slot}</Text>
              </View>

              {/* day cells */}
              {days.map((day) => {
                const player = getCellPlayer(day, slot);
                const noGame = day.players_available === 0;
                return (
                  <View key={day.date} style={[styles.dayCell, noGame && styles.dayCellEmpty]}>
                    {player ? (
                      <Text style={styles.playerText} numberOfLines={2}>
                        {formatName(player)}
                      </Text>
                    ) : noGame ? null : (
                      <Text style={styles.blankCell}>—</Text>
                    )}
                  </View>
                );
              })}
            </View>
          ))}

          {/* ---- Benched row ---- */}
          <View style={[styles.row, styles.benchedHeaderRow]}>
            <View style={styles.slotCell}>
              <Text style={styles.benchedSlotLabel}>Bench</Text>
            </View>
            {days.map((day) => {
              const benched = getBenched(day);
              const noGame = day.players_available === 0;
              return (
                <View key={day.date} style={[styles.dayCell, styles.benchedCell, noGame && styles.dayCellEmpty]}>
                  {benched.length > 0 ? (
                    benched.map((name) => (
                      <Text key={name} style={styles.benchedName} numberOfLines={1}>
                        {formatName(name)}
                      </Text>
                    ))
                  ) : noGame ? null : (
                    <Text style={styles.allStartText}>All start</Text>
                  )}
                </View>
              );
            })}
          </View>

          {/* ---- Total games row ---- */}
          <View style={[styles.row, styles.totalRow]}>
            <View style={styles.slotCell}>
              <Text style={styles.totalLabel}>Total</Text>
            </View>
            {days.map((day) => {
              const total = getTotal(day);
              const starting = day.players_starting;
              return (
                <View key={day.date} style={styles.totalCell}>
                  <Text style={[styles.totalGames, { color: total === 0 ? "#9e9e9e" : "#fff" }]}>
                    {total > 0 ? `${starting}/${total}` : "—"}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>
      </ScrollView>

      {/* Legend */}
      <View style={styles.legend}>
        <Text style={styles.legendTitle}>Starting/Available games</Text>
        <View style={styles.legendRow}>
          <LegendDot color="#2e7d32" label="4+ games" />
          <LegendDot color="#1565c0" label="3 games" />
          <LegendDot color="#e65100" label="2 games" />
          <LegendDot color="#9e9e9e" label="0 games" />
        </View>
      </View>
    </ScrollView>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

/** Shorten "FirstName LastName" → "F. LastName" to fit narrow columns */
function formatName(name: string): string {
  const parts = name.trim().split(" ");
  if (parts.length <= 1) return name;
  return `${parts[0][0]}. ${parts.slice(1).join(" ")}`;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  title: { fontSize: 22, fontWeight: "700", marginTop: 16, marginHorizontal: 16 },
  subtitle: { fontSize: 13, marginHorizontal: 16, marginBottom: 4 },
  emptyText: { color: "#888", textAlign: "center", margin: 32, fontSize: 14 },
  scrollOuter: { paddingBottom: 40 },

  // Table rows
  row: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
    minHeight: 42,
  },
  rowAlt: { backgroundColor: "#fafafa" },
  headerRow: { backgroundColor: "#6750a4" },
  benchedHeaderRow: { backgroundColor: "#fff3e0" },
  totalRow: { backgroundColor: "#37474f", minHeight: 38 },

  // Slot label column (leftmost, fixed)
  slotCell: {
    width: SLOT_COL_W,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 6,
    borderRightWidth: 1,
    borderRightColor: "#e0e0e0",
    backgroundColor: "inherit",
  },
  cornerCell: { backgroundColor: "#6750a4" },
  cornerText: { color: "#fff", fontWeight: "700", fontSize: 12 },
  slotLabel: { fontWeight: "700", fontSize: 12, color: "#6750a4" },
  benchedSlotLabel: { fontWeight: "700", fontSize: 12, color: "#e65100" },
  totalLabel: { fontWeight: "700", fontSize: 12, color: "#fff" },

  // Day header cells
  dayHeaderCell: {
    width: DAY_COL_W,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 6,
    borderRightWidth: 1,
    borderRightColor: "rgba(255,255,255,0.2)",
  },
  dayHeaderName: { color: "#fff", fontWeight: "700", fontSize: 13 },
  dayHeaderDate: { color: "rgba(255,255,255,0.85)", fontSize: 10 },
  dayHeaderGames: { color: "#fff", fontSize: 11, fontWeight: "600", marginTop: 2 },

  // Day data cells
  dayCell: {
    width: DAY_COL_W,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 4,
    paddingHorizontal: 3,
    borderRightWidth: 1,
    borderRightColor: "#e0e0e0",
  },
  dayCellEmpty: { backgroundColor: "#f5f5f5" },
  playerText: { fontSize: 11, textAlign: "center", color: "#212121", fontWeight: "500" },
  blankCell: { fontSize: 12, color: "#bbb" },

  // Benched row cells
  benchedCell: { alignItems: "center", paddingVertical: 6 },
  benchedName: { fontSize: 10, color: "#e65100", fontWeight: "600", textAlign: "center" },
  allStartText: { fontSize: 10, color: "#2e7d32", fontWeight: "600" },

  // Total row cells
  totalCell: {
    width: DAY_COL_W,
    justifyContent: "center",
    alignItems: "center",
    borderRightWidth: 1,
    borderRightColor: "rgba(255,255,255,0.15)",
  },
  totalGames: { fontWeight: "700", fontSize: 13 },

  // Legend
  legend: { marginHorizontal: 16, marginTop: 16, padding: 12, backgroundColor: "#f5f5f5", borderRadius: 8 },
  legendTitle: { fontWeight: "700", fontSize: 13, marginBottom: 8 },
  legendRow: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendDot: { width: 12, height: 12, borderRadius: 6 },
  legendText: { fontSize: 12, color: "#555" },
});
