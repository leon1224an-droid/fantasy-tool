import React, { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { Chip, Divider, Menu, Button, Surface, Text, useTheme } from "react-native-paper";
import { useQuery } from "@tanstack/react-query";
import { getLeagueTeams, getLeagueMatchup, MatchupResult } from "../../lib/api";

const WEEKS = [21, 22, 23] as const;

const CATEGORIES: { key: string; label: string }[] = [
  { key: "pts",    label: "Points" },
  { key: "reb",    label: "Rebounds" },
  { key: "ast",    label: "Assists" },
  { key: "stl",    label: "Steals" },
  { key: "blk",    label: "Blocks" },
  { key: "tov",    label: "Turnovers" },
  { key: "tpm",    label: "3-Pointers" },
  { key: "fg_pct", label: "FG%" },
  { key: "ft_pct", label: "FT%" },
];

function fmt(val: number, cat: string): string {
  if (cat === "fg_pct" || cat === "ft_pct") return (val * 100).toFixed(1) + "%";
  return val.toFixed(1);
}

export default function MatchupScreen() {
  const theme = useTheme();
  const [week, setWeek] = useState<number>(21);
  const [teamA, setTeamA] = useState<string | null>(null);
  const [teamB, setTeamB] = useState<string | null>(null);
  const [menuA, setMenuA] = useState(false);
  const [menuB, setMenuB] = useState(false);

  const { data: teams } = useQuery({
    queryKey: ["league-teams"],
    queryFn: getLeagueTeams,
  });

  const canFetch = !!teamA && !!teamB && teamA !== teamB;

  const { data: matchup, isLoading, error } = useQuery({
    queryKey: ["matchup", teamA, teamB, week],
    queryFn: () => getLeagueMatchup(teamA!, teamB!, week),
    enabled: canFetch,
  });

  const teamName = (key: string | null) =>
    teams?.find((t) => t.team_key === key)?.team_name ?? "Select team";

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={[styles.heading, { color: theme.colors.onBackground }]}>Matchup</Text>

        {/* Week filter */}
        <Text style={styles.filterLabel}>Projection Week</Text>
        <View style={styles.weekRow}>
          {WEEKS.map((w) => (
            <Chip
              key={w}
              selected={week === w}
              onPress={() => setWeek(w)}
              compact
              showSelectedOverlay
              style={styles.chip}
            >
              Week {w}
            </Chip>
          ))}
        </View>

        {/* Team pickers */}
        {!teams || teams.length === 0 ? (
          <Text style={styles.hint}>No teams found. Run "Sync" on the Dashboard first.</Text>
        ) : (
          <>
            <Text style={styles.filterLabel}>Teams</Text>
            <View style={styles.pickerRow}>
              <View style={styles.pickerCol}>
                <Menu
                  visible={menuA}
                  onDismiss={() => setMenuA(false)}
                  anchor={
                    <Button
                      mode="outlined"
                      onPress={() => setMenuA(true)}
                      style={styles.pickerBtn}
                      labelStyle={styles.pickerBtnLabel}
                    >
                      {teamName(teamA)}
                    </Button>
                  }
                >
                  {teams.map((t) => (
                    <Menu.Item
                      key={t.team_key}
                      title={t.team_name}
                      onPress={() => { setTeamA(t.team_key); setMenuA(false); }}
                    />
                  ))}
                </Menu>
              </View>

              <Text style={styles.vsText}>vs</Text>

              <View style={styles.pickerCol}>
                <Menu
                  visible={menuB}
                  onDismiss={() => setMenuB(false)}
                  anchor={
                    <Button
                      mode="outlined"
                      onPress={() => setMenuB(true)}
                      style={styles.pickerBtn}
                      labelStyle={styles.pickerBtnLabel}
                    >
                      {teamName(teamB)}
                    </Button>
                  }
                >
                  {teams.map((t) => (
                    <Menu.Item
                      key={t.team_key}
                      title={t.team_name}
                      onPress={() => { setTeamB(t.team_key); setMenuB(false); }}
                    />
                  ))}
                </Menu>
              </View>
            </View>
          </>
        )}

        {teamA === teamB && teamA !== null && (
          <Text style={styles.errorText}>Select two different teams.</Text>
        )}

        {isLoading && <Text style={styles.hint}>Loading matchup…</Text>}
        {error && <Text style={styles.errorText}>{(error as Error).message}</Text>}

        {matchup && <MatchupCard matchup={matchup} />}
      </ScrollView>
    </View>
  );
}

function MatchupCard({ matchup }: { matchup: MatchupResult }) {
  const nameA = matchup.team_a.split(" ").slice(-1)[0];
  const nameB = matchup.team_b.split(" ").slice(-1)[0];

  return (
    <>
      {/* Summary */}
      <Surface style={[styles.card, styles.summaryCard]} elevation={2}>
        <View style={styles.summaryRow}>
          <View style={styles.summaryTeam}>
            <Text style={styles.summaryTeamName} numberOfLines={2}>{matchup.team_a}</Text>
            <Text style={styles.summaryWins}>{matchup.a_wins}</Text>
            <Text style={styles.summaryGames}>{matchup.a_games} games</Text>
          </View>
          <View style={styles.summarySep}>
            <Text style={styles.summaryCatLabel}>cats</Text>
            {matchup.ties > 0 && (
              <Text style={styles.tieText}>{matchup.ties} tie{matchup.ties !== 1 ? "s" : ""}</Text>
            )}
          </View>
          <View style={styles.summaryTeam}>
            <Text style={styles.summaryTeamName} numberOfLines={2}>{matchup.team_b}</Text>
            <Text style={styles.summaryWins}>{matchup.b_wins}</Text>
            <Text style={styles.summaryGames}>{matchup.b_games} games</Text>
          </View>
        </View>
      </Surface>

      {/* Category breakdown */}
      <Surface style={styles.card} elevation={1}>
        {/* Header */}
        <View style={[styles.catRow, styles.catHeader]}>
          <Text style={[styles.catVal, styles.catHeaderText]}>{nameA}</Text>
          <Text style={[styles.catName, styles.catHeaderText]}>Category</Text>
          <Text style={[styles.catVal, styles.catValRight, styles.catHeaderText]}>{nameB}</Text>
        </View>
        <Divider />
        {matchup.categories.map((cat, idx) => {
          const meta = CATEGORIES.find((c) => c.key === cat.category);
          const aWins = cat.winner === "a";
          const bWins = cat.winner === "b";
          return (
            <View key={cat.category}>
              <View style={styles.catRow}>
                <Text style={[styles.catVal, aWins && styles.winnerText]}>
                  {fmt(cat.a_value, cat.category)}
                </Text>
                <View style={styles.catNameCol}>
                  <Text style={styles.catName}>{meta?.label ?? cat.category}</Text>
                  {cat.winner !== "tie" && (
                    <Text style={styles.arrowText}>{aWins ? "◀" : "▶"}</Text>
                  )}
                </View>
                <Text style={[styles.catVal, styles.catValRight, bWins && styles.winnerText]}>
                  {fmt(cat.b_value, cat.category)}
                </Text>
              </View>
              {idx < matchup.categories.length - 1 && <Divider />}
            </View>
          );
        })}
      </Surface>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, paddingBottom: 32, gap: 12 },
  heading: { fontSize: 18, fontWeight: "700", letterSpacing: -0.3, marginBottom: 4 },

  filterLabel: { fontSize: 11, fontWeight: "700", color: "#888", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 },
  weekRow: { flexDirection: "row", gap: 8, marginBottom: 4 },
  chip: {},

  pickerRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  pickerCol: { flex: 1 },
  pickerBtn: { borderRadius: 10 },
  pickerBtnLabel: { fontSize: 12 },
  vsText: { fontSize: 15, fontWeight: "700", color: "#aaa" },

  card: { borderRadius: 16, backgroundColor: "#fff", overflow: "hidden" },
  summaryCard: { padding: 16 },
  summaryRow: { flexDirection: "row", alignItems: "center" },
  summaryTeam: { flex: 1, alignItems: "center", gap: 2 },
  summaryTeamName: { fontSize: 12, fontWeight: "600", color: "#555", textAlign: "center" },
  summaryWins: { fontSize: 32, fontWeight: "900", color: "#6750a4", lineHeight: 38 },
  summaryGames: { fontSize: 11, color: "#aaa", fontWeight: "500" },
  summarySep: { paddingHorizontal: 12, alignItems: "center" },
  summaryCatLabel: { fontSize: 12, color: "#888" },
  tieText: { fontSize: 11, color: "#aaa", marginTop: 4 },

  catRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12 },
  catHeader: { backgroundColor: "#f5f5f5" },
  catHeaderText: { fontWeight: "700", color: "#666", fontSize: 11 },
  catVal: { width: 60, fontSize: 14, color: "#555", textAlign: "left" },
  catValRight: { textAlign: "right" },
  catNameCol: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  catName: { fontSize: 13, fontWeight: "600", color: "#1a1a1a", textAlign: "center" },
  arrowText: { fontSize: 11, color: "#6750a4" },
  winnerText: { fontWeight: "800", color: "#2e7d32" },

  hint: { color: "#888", textAlign: "center", fontSize: 13 },
  errorText: { color: "#c62828", textAlign: "center", fontSize: 13 },
});
