import React from "react";
import { View, StyleSheet, ScrollView } from "react-native";
import { DataTable, Text, Divider } from "react-native-paper";
import { SlotAssignment } from "../lib/api";

interface Props {
  starters: SlotAssignment[];
  bench: string[];
  totalProjected: number;
}

export function LineupTable({ starters, bench, totalProjected }: Props) {
  return (
    <ScrollView>
      <DataTable>
        <DataTable.Header>
          <DataTable.Title style={styles.slotCol}>Slot</DataTable.Title>
          <DataTable.Title style={styles.playerCol}>Player</DataTable.Title>
          <DataTable.Title numeric style={styles.ptsCol}>
            Proj. Total
          </DataTable.Title>
        </DataTable.Header>

        {starters.map((s) => (
          <DataTable.Row key={s.slot}>
            <DataTable.Cell style={styles.slotCol}>
              <Text style={styles.slotText}>{s.slot}</Text>
            </DataTable.Cell>
            <DataTable.Cell style={styles.playerCol}>{s.player}</DataTable.Cell>
            <DataTable.Cell numeric style={styles.ptsCol}>
              {s.projected_total.toFixed(1)}
            </DataTable.Cell>
          </DataTable.Row>
        ))}
      </DataTable>

      <Divider style={styles.divider} />

      <View style={styles.benchSection}>
        <Text style={styles.benchHeader}>Bench</Text>
        {bench.map((player) => (
          <Text key={player} style={styles.benchPlayer}>
            {player}
          </Text>
        ))}
      </View>

      <Divider style={styles.divider} />

      <View style={styles.totalRow}>
        <Text style={styles.totalLabel}>Total Projected Points</Text>
        <Text style={styles.totalValue}>{totalProjected.toFixed(1)}</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  slotCol: { flex: 1 },
  playerCol: { flex: 2 },
  ptsCol: { flex: 1 },
  slotText: { fontWeight: "700", fontSize: 12 },
  divider: { marginVertical: 8 },
  benchSection: { paddingHorizontal: 16, paddingVertical: 8 },
  benchHeader: { fontWeight: "700", fontSize: 14, marginBottom: 4 },
  benchPlayer: { fontSize: 13, color: "#888", paddingVertical: 2 },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  totalLabel: { fontWeight: "700", fontSize: 15 },
  totalValue: { fontWeight: "700", fontSize: 15, color: "#6750a4" },
});
