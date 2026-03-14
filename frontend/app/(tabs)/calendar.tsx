import React, { useState } from "react";
import { ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import { Surface, Text, useTheme } from "react-native-paper";
import { useQuery } from "@tanstack/react-query";
import { getCalendar, WeeklyCalendarResponse, DailyLineupResponse } from "../../lib/api";
import { WeekSelector } from "../../components/WeekSelector";
import { LoadingOrError } from "../../components/LoadingOrError";

const SLOT_ORDER = ["PG", "SG", "G", "SF", "PF", "F", "C1", "C2", "UTIL1", "UTIL2"];

const SLOT_COL_W = 52;
const MIN_DAY_COL_W = 58;

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

      {weekData && <WeekTable weekData={weekData} theme={theme} />}

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
function WeekTable({ weekData, theme }: { weekData: WeeklyCalendarResponse; theme: ReturnType<typeof useTheme> }) {
  const days = weekData.days;
  const { width: screenWidth } = useWindowDimensions();

  // Compute day column width to fill available screen width
  const H_PAD = 32; // 16px each side
  const availableWidth = screenWidth - H_PAD - SLOT_COL_W;
  const DAY_COL_W = Math.max(MIN_DAY_COL_W, Math.floor(availableWidth / days.length));

  // Weekly aggregate totals
  const totalGames = days.reduce((s, d) => s + d.players_available, 0);
  const totalStarting = days.reduce((s, d) => s + d.players_starting, 0);
  const totalBenched = totalGames - totalStarting;

  const getCellPlayer = (day: DailyLineupResponse, slot: string): string | null => {
    if (day.players_available === 0) return null;
    return day.lineup.find((l) => l.slot === slot)?.player ?? null;
  };

  const dayHeaderBg = (day: DailyLineupResponse): string => {
    if (day.players_available === 0) return "#9e9e9e";
    if (day.benched.length === 0) return "#2e7d32";   // all starting
    return "#e65100";                                   // some benched
  };

  return (
    <ScrollView style={styles.flex1} contentContainerStyle={styles.scrollOuter} showsVerticalScrollIndicator={false}>
      {/* Weekly totals summary */}
      <View style={styles.weekSummary}>
        <WeekStatBox label="Total Games" value={totalGames} color="#1565c0" />
        <WeekStatBox label="Starting" value={totalStarting} color="#2e7d32" />
        <WeekStatBox label="Benched" value={totalBenched} color={totalBenched > 0 ? "#e65100" : "#9e9e9e"} />
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tableScrollH}>
      <Surface style={styles.tableSurface} elevation={1}>
        <View>
          {/* ---- Day header row ---- */}
          <View style={[styles.row, styles.headerRow]}>
            <View style={[styles.slotCell, styles.cornerCell, { width: SLOT_COL_W }]}>
              <Text style={styles.cornerText}>Slot</Text>
            </View>
            {days.map((day) => {
              const bg = dayHeaderBg(day);
              const parts = day.day_label.split(" ");
              const dayName = parts[0] ?? day.day_label;
              const dayDate = parts.slice(1).join(" ");
              return (
                <View key={day.date} style={[styles.dayHeaderCell, { backgroundColor: bg, width: DAY_COL_W }]}>
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
              <View style={[styles.slotCell, { width: SLOT_COL_W }]}>
                <Text style={styles.slotLabel}>{slot}</Text>
              </View>
              {days.map((day) => {
                const player = getCellPlayer(day, slot);
                const noGame = day.players_available === 0;
                return (
                  <View key={day.date} style={[styles.dayCell, { width: DAY_COL_W }, noGame && styles.dayCellEmpty]}>
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
            <View style={[styles.slotCell, { width: SLOT_COL_W }]}>
              <Text style={styles.benchSlotLabel}>Bench</Text>
            </View>
            {days.map((day) => {
              const benched = day.benched;
              const noGame = day.players_available === 0;
              return (
                <View key={day.date} style={[styles.dayCell, styles.benchCell, { width: DAY_COL_W }, noGame && styles.dayCellEmpty]}>
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
            <View style={[styles.slotCell, { width: SLOT_COL_W }]}>
              <Text style={styles.totalSlotLabel}>Total</Text>
            </View>
            {days.map((day) => {
              const total = day.players_available;
              const starting = day.players_starting;
              const hasGames = total > 0;
              return (
                <View key={day.date} style={[styles.totalCell, { width: DAY_COL_W }]}>
                  <Text style={[styles.totalText, !hasGames && styles.totalTextDim]}>
                    {hasGames ? `${starting}/${total}` : "—"}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>
      </Surface>
      </ScrollView>

      {/* Legend */}
      <View style={styles.legend}>
        <View style={styles.legendRow}>
          <LegendDot color="#2e7d32" label="All starting" />
          <LegendDot color="#e65100" label="Players benched" />
          <LegendDot color="#9e9e9e" label="No games" />
        </View>
        <Text style={styles.legendSub}>Total row = starters / players with games</Text>
      </View>
    </ScrollView>
  );
}

function WeekStatBox({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={[styles.weekStatBox, { borderColor: color + "40" }]}>
      <Text style={[styles.weekStatValue, { color }]}>{value}</Text>
      <Text style={styles.weekStatLabel}>{label}</Text>
    </View>
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
  flex1: { flex: 1 },
  emptyText: { color: "#888", textAlign: "center", margin: 32, fontSize: 14 },
  scrollOuter: { padding: 16, paddingBottom: 40 },

  weekSummary: { flexDirection: "row", gap: 10, marginBottom: 12 },
  weekStatBox: {
    flex: 1, alignItems: "center", paddingVertical: 10, borderRadius: 12,
    backgroundColor: "#fff", borderWidth: 1,
  },
  weekStatValue: { fontSize: 20, fontWeight: "800", lineHeight: 24 },
  weekStatLabel: { fontSize: 11, color: "#888", marginTop: 2 },

  tableScrollH: { marginBottom: 4 },
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

  // Slot label (first column) — width passed inline
  slotCell: {
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

  // Day header — width passed inline
  dayHeaderCell: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: "rgba(255,255,255,0.25)",
  },
  dayHeaderName: { color: "#fff", fontWeight: "700", fontSize: 13 },
  dayHeaderDate: { color: "rgba(255,255,255,0.8)", fontSize: 10, marginTop: 1 },
  dayHeaderGames: { color: "#fff", fontSize: 10, fontWeight: "600", marginTop: 2 },

  // Data cells — width passed inline
  dayCell: {
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

  // Total cells — width passed inline
  totalCell: {
    justifyContent: "center",
    alignItems: "center",
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: "rgba(255,255,255,0.15)",
  },
  totalText: { fontWeight: "700", fontSize: 13, color: "#fff" },
  totalTextDim: { color: "#90a4ae" },

  // Legend
  legend: { marginTop: 14, padding: 12, backgroundColor: "#f5f5f5", borderRadius: 12 },
  legendRow: { flexDirection: "row", gap: 14, marginBottom: 6 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { fontSize: 11, color: "#666" },
  legendSub: { fontSize: 11, color: "#888" },
});
