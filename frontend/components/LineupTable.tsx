import React from "react";
import { View, StyleSheet, ScrollView } from "react-native";
import { Surface, Text } from "react-native-paper";
import { SlotAssignment } from "../lib/api";

interface Props {
  starters: SlotAssignment[];
  bench: string[];
  totalProjected: number;
}

export function LineupTable({ starters, bench, totalProjected }: Props) {
  return (
    <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
      <Surface style={styles.surface} elevation={1}>
        {/* Starters */}
        <View style={styles.tableHeader}>
          <Text style={[styles.colLabel, styles.slotColW]}>Slot</Text>
          <Text style={[styles.colLabel, styles.playerColFlex]}>Player</Text>
          <Text style={[styles.colLabel, styles.ptsColW]}>Proj</Text>
        </View>

        {starters.map((s, idx) => (
          <View
            key={s.slot}
            style={[styles.tableRow, idx % 2 === 1 && styles.tableRowAlt]}
          >
            <Text style={[styles.slotText, styles.slotColW]}>{s.slot}</Text>
            <Text style={[styles.playerText, styles.playerColFlex]} numberOfLines={1}>
              {s.player}
            </Text>
            <Text style={[styles.ptsText, styles.ptsColW]}>
              {s.projected_total.toFixed(1)}
            </Text>
          </View>
        ))}

        {/* Bench divider */}
        <View style={styles.benchHeader}>
          <Text style={styles.benchTitle}>Bench</Text>
        </View>
        {bench.map((player) => (
          <View key={player} style={styles.benchRow}>
            <Text style={styles.benchPlayer}>{player}</Text>
          </View>
        ))}

        {/* Total */}
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Total Projected</Text>
          <Text style={styles.totalValue}>{totalProjected.toFixed(1)} pts</Text>
        </View>
      </Surface>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 16, paddingBottom: 32 },
  surface: { borderRadius: 16, backgroundColor: "#fff", overflow: "hidden" },

  tableHeader: {
    flexDirection: "row",
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: "#6750a4",
  },
  colLabel: { fontSize: 11, fontWeight: "700", color: "#fff", textTransform: "uppercase", letterSpacing: 0.4 },

  tableRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#f0f0f0",
  },
  tableRowAlt: { backgroundColor: "#fafafa" },

  slotColW: { width: 52 },
  playerColFlex: { flex: 1, paddingRight: 8 },
  ptsColW: { width: 52, textAlign: "right" },

  slotText: { fontSize: 12, fontWeight: "700", color: "#6750a4" },
  playerText: { fontSize: 14, color: "#1a1a1a" },
  ptsText: { fontSize: 14, fontWeight: "600", color: "#555", textAlign: "right" },

  benchHeader: {
    backgroundColor: "#f5f5f5",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e0e0e0",
  },
  benchTitle: { fontSize: 11, fontWeight: "700", color: "#888", textTransform: "uppercase", letterSpacing: 0.4 },
  benchRow: { paddingHorizontal: 16, paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#f0f0f0" },
  benchPlayer: { fontSize: 14, color: "#888" },

  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: "#f8f5ff",
  },
  totalLabel: { fontSize: 14, fontWeight: "600", color: "#555" },
  totalValue: { fontSize: 18, fontWeight: "800", color: "#6750a4" },
});
