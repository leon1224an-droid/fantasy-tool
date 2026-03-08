import React from "react";
import { View, StyleSheet } from "react-native";
import { Card, Text, Chip } from "react-native-paper";
import { ProjectionRow } from "../lib/api";

interface Props {
  projection: ProjectionRow;
}

export function ProjectionCard({ projection: p }: Props) {
  return (
    <Card style={styles.card} mode="elevated">
      <Card.Content>
        <View style={styles.header}>
          <View>
            <Text style={styles.name}>{p.player}</Text>
            <Text style={styles.meta}>
              {p.team} · Games: {p.games_count}
            </Text>
          </View>
          <View style={styles.totalBadge}>
            <Text style={styles.totalValue}>{p.projected_total.toFixed(1)}</Text>
            <Text style={styles.totalLabel}>proj total</Text>
          </View>
        </View>

        <View style={styles.chips}>
          <StatChip label="PTS" value={p.pts_pg} />
          <StatChip label="REB" value={p.reb_pg} />
          <StatChip label="AST" value={p.ast_pg} />
          <StatChip label="STL" value={p.stl_pg} />
          <StatChip label="BLK" value={p.blk_pg} />
          <StatChip label="TOV" value={p.tov_pg} negative />
          <StatChip label="3PM" value={p.tpm_pg} />
        </View>

        <Text style={styles.ppgLine}>
          Fantasy PPG: {p.fantasy_ppg.toFixed(1)} · FG%:{" "}
          {(p.fg_pct * 100).toFixed(1)} · FT%: {(p.ft_pct * 100).toFixed(1)}
        </Text>
      </Card.Content>
    </Card>
  );
}

function StatChip({
  label,
  value,
  negative,
}: {
  label: string;
  value: number;
  negative?: boolean;
}) {
  return (
    <Chip
      style={[styles.chip, negative && styles.negChip]}
      textStyle={styles.chipText}
      compact
    >
      {label}: {value.toFixed(1)}
    </Chip>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: 16, marginVertical: 6 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 10,
  },
  name: { fontSize: 16, fontWeight: "700" },
  meta: { fontSize: 12, color: "#888", marginTop: 2 },
  totalBadge: { alignItems: "flex-end" },
  totalValue: { fontSize: 20, fontWeight: "800", color: "#6750a4" },
  totalLabel: { fontSize: 10, color: "#888" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginBottom: 8 },
  chip: { backgroundColor: "#e8def8" },
  negChip: { backgroundColor: "#fce8e8" },
  chipText: { fontSize: 11 },
  ppgLine: { fontSize: 11, color: "#666" },
});
