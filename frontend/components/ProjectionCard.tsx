import React from "react";
import { View, StyleSheet } from "react-native";
import { Surface, Text } from "react-native-paper";
import { ProjectionRow } from "../lib/api";

interface Props {
  projection: ProjectionRow;
}

export function ProjectionCard({ projection: p }: Props) {
  return (
    <Surface style={styles.card} elevation={1}>
      <View style={styles.header}>
        <View style={styles.nameBlock}>
          <Text style={styles.name} numberOfLines={1}>{p.player}</Text>
          <Text style={styles.meta}>
            {p.team} · {p.games_count}G · PPG {p.fantasy_ppg.toFixed(1)}
          </Text>
        </View>
        <View style={styles.totalBlock}>
          <Text style={styles.totalValue}>{p.projected_total.toFixed(1)}</Text>
          <Text style={styles.totalLabel}>proj</Text>
        </View>
      </View>

      <View style={styles.statsRow}>
        <StatPill label="PTS" value={p.pts_pg} />
        <StatPill label="REB" value={p.reb_pg} />
        <StatPill label="AST" value={p.ast_pg} />
        <StatPill label="STL" value={p.stl_pg} accent />
        <StatPill label="BLK" value={p.blk_pg} accent />
        <StatPill label="TOV" value={p.tov_pg} negative />
        <StatPill label="3PM" value={p.tpm_pg} />
      </View>

      <Text style={styles.footer}>
        FG {(p.fg_pct * 100).toFixed(1)}%  ·  FT {(p.ft_pct * 100).toFixed(1)}%
      </Text>
    </Surface>
  );
}

function StatPill({ label, value, negative, accent }: {
  label: string;
  value: number;
  negative?: boolean;
  accent?: boolean;
}) {
  const bg = negative ? "#fce8e8" : accent ? "#e8f5e9" : "#f0ebff";
  const fg = negative ? "#c62828" : accent ? "#2e7d32" : "#5b21b6";
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      <Text style={[styles.pillLabel, { color: fg }]}>{label}</Text>
      <Text style={[styles.pillValue, { color: fg }]}>{value.toFixed(1)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginVertical: 5,
    borderRadius: 14,
    backgroundColor: "#fff",
    padding: 14,
    overflow: "hidden",
  },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 },
  nameBlock: { flex: 1, paddingRight: 8 },
  name: { fontSize: 15, fontWeight: "700", color: "#1a1a1a" },
  meta: { fontSize: 12, color: "#888", marginTop: 2 },
  totalBlock: { alignItems: "flex-end" },
  totalValue: { fontSize: 24, fontWeight: "800", color: "#6750a4", lineHeight: 28 },
  totalLabel: { fontSize: 10, color: "#aaa" },
  statsRow: { flexDirection: "row", flexWrap: "wrap", gap: 5, marginBottom: 8 },
  pill: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, alignItems: "center" },
  pillLabel: { fontSize: 9, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.3 },
  pillValue: { fontSize: 13, fontWeight: "700" },
  footer: { fontSize: 11, color: "#aaa" },
});
