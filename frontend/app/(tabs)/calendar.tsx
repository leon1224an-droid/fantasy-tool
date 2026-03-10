import React, { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { Surface, Text, useTheme } from "react-native-paper";
import { useQuery } from "@tanstack/react-query";
import { getCalendar, WeeklyCalendarResponse, DailyLineupResponse } from "../../lib/api";
import { WeekSelector } from "../../components/WeekSelector";
import { LoadingOrError } from "../../components/LoadingOrError";

const SLOT_ORDER = ["PG", "SG", "G", "SF", "PF", "F", "C1", "C2", "UTIL1", "UTIL2"];

const SLOT_COL_W = 60;
const DAY_COL_W = 80;

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
// Horizontal week table
// ---------------------------------------------------------------------------
function WeekTable({ weekData }: { weekData: WeeklyCalendarResponse }) {
  const days = weekData.days;

  const getCellPlayer = (day: DailyLineupResponse, slot: string): string | null => {
    if (day.players_available === 0) return null;
    return day.lineup.find((l) => l.slot === slot)?.player ?? null;
  };

  const dayHeaderBg = (day: DailyLineupResponse): string => {
    const n = day.players_available;
    if (n === 0) return "#9e9e9e";
    if (n >= 4) return "#2e7d32";
    if (n === 3) return "#1565c0";
    if (n === 2) return "#e65100";
    return "#6750a4";
  };

  return (
    <ScrollView contentContainerStyle={styles.scrollOuter} showsVerticalScrollIndicator={false}>
      <Surface style={styles.tableSurface} elevation={1}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View>
            {/* ---- Day header row ---- */}
            <View style={[styles.row, styles.headerRow]}>
              <View style={[styles.slotCell, styles.cornerCell]}>
                <Text style={styles.cornerText}>Slot</Text>
              </View>
              {days.map((day) => {
                const bg = dayHeaderBg(day);
                const parts = day.day_label.split(" ");
                const dayName = parts[0] ?? day.day_label;
                const dayDate = parts.slice(1).join(" ");
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
                <View style={styles.slotCell}>
                  <Text style={styles.slotLabel}>{slot}</Text>
                </View>
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
            <View style={[styles.row, styles.benchRow]}>
              <View style={styles.slotCell}>
                <Text style={styles.benchSlotLabel}>Bench</Text>
              </View>
              {days.map((day) => {
                const benched = day.benched;
                const noGame = day.players_available === 0;
                return (
                  <View key={day.date} style={[styles.dayCell, styles.benchCell, noGame && styles.dayCellEmpty]}>
                    {benched.length > 0 ? (
                      benched.map((name) => (
                        <Text key={name} style={styles.benchedName} numberOfLines={1}>
                          {formatName(name)}
                        </Text>
                      ))
                    ) : noGame ? null : (
                      <Text style={styles.allStartText}>✓ All</Text>
                    )}
                  </View>
                );
              })}
            </View>

            {/* ---- Total row ---- */}
            <View style={[styles.row, styles.totalRow]}>
              <View style={styles.slotCell}>
                <Text style={styles.totalSlotLabel}>Total</Text>
              </View>
              {days.map((day) => {
                const total = day.players_available;
                const starting = day.players_starting;
                const hasGames = total > 0;
                return (
                  <View key={day.date} style={styles.totalCell}>
                    <Text style={[styles.totalText, !hasGames && styles.totalTextDim]}>
                      {hasGames ? `${starting}/${total}` : "—"}
                    </Text>
                  </View>
                );
              })}
            </View>
          </View>
        </ScrollView>
      </Surface>

      {/* Legend */}
      <View style={styles.legend}>
        <Text style={styles.legendTitle}>Day header color = games that day</Text>
        <View style={styles.legendRow}>
          <LegendDot color="#2e7d32" label="4+" />
          <LegendDot color="#1565c0" label="3" />
          <LegendDot color="#e65100" label="2" />
          <LegendDot color="#9e9e9e" label="0" />
        </View>
        <Text style={styles.legendSub}>
          Total row = starters / players with games that day
        </Text>
      </View>
    </ScrollView>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={styles.legendText}>{label} games</Text>
    </View>
  );
}

function formatName(name: string): string {
  const parts = name.trim().split(" ");
  if (parts.length <= 1) return name;
  return `${parts[0][0]}. ${parts.slice(1).join(" ")}`;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  emptyText: { color: "#888", textAlign: "center", margin: 32, fontSize: 14 },
  scrollOuter: { padding: 16, paddingBottom: 40 },

  tableSurface: {
    borderRadius: 14,
    overflow: "hidden",
    backgroundColor: "#fff",
  },

  // Rows
  row: {
    flexDirection: "row",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e0e0e0",
    minHeight: 40,
  },
  rowAlt: { backgroundColor: "#fafafa" },
  headerRow: {},
  benchRow: { backgroundColor: "#fff8f0" },
  totalRow: { backgroundColor: "#37474f" },

  // Slot label (first column)
  slotCell: {
    width: SLOT_COL_W,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 8,
    borderRightWidth: 1,
    borderRightColor: "#e0e0e0",
  },
  cornerCell: { backgroundColor: "#6750a4" },
  cornerText: { color: "#fff", fontWeight: "700", fontSize: 11 },
  slotLabel: { fontWeight: "700", fontSize: 11, color: "#6750a4" },
  benchSlotLabel: { fontWeight: "700", fontSize: 11, color: "#e65100" },
  totalSlotLabel: { fontWeight: "700", fontSize: 11, color: "#fff" },

  // Day header
  dayHeaderCell: {
    width: DAY_COL_W,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: "rgba(255,255,255,0.25)",
  },
  dayHeaderName: { color: "#fff", fontWeight: "700", fontSize: 13 },
  dayHeaderDate: { color: "rgba(255,255,255,0.8)", fontSize: 10, marginTop: 1 },
  dayHeaderGames: { color: "#fff", fontSize: 10, fontWeight: "600", marginTop: 2 },

  // Data cells
  dayCell: {
    width: DAY_COL_W,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 5,
    paddingHorizontal: 4,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: "#e0e0e0",
  },
  dayCellEmpty: { backgroundColor: "#f5f5f5" },
  playerText: { fontSize: 11, textAlign: "center", color: "#1a1a1a", fontWeight: "500", lineHeight: 15 },
  blankCell: { fontSize: 13, color: "#ccc" },

  // Bench cells
  benchCell: { paddingVertical: 6 },
  benchedName: { fontSize: 10, color: "#e65100", fontWeight: "600", textAlign: "center" },
  allStartText: { fontSize: 10, color: "#2e7d32", fontWeight: "700" },

  // Total cells
  totalCell: {
    width: DAY_COL_W,
    justifyContent: "center",
    alignItems: "center",
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: "rgba(255,255,255,0.15)",
  },
  totalText: { fontWeight: "700", fontSize: 13, color: "#fff" },
  totalTextDim: { color: "#90a4ae" },

  // Legend
  legend: { marginTop: 14, padding: 12, backgroundColor: "#f5f5f5", borderRadius: 12 },
  legendTitle: { fontWeight: "600", fontSize: 12, color: "#555", marginBottom: 8 },
  legendRow: { flexDirection: "row", gap: 14, marginBottom: 6 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { fontSize: 11, color: "#666" },
  legendSub: { fontSize: 11, color: "#888" },
});
