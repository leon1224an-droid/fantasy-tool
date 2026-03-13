import React, { useState } from "react";
import { ScrollView, StyleSheet, TouchableOpacity, View } from "react-native";
import { Button, Chip, Divider, Menu, Surface, Text, useTheme } from "react-native-paper";
import { useQuery } from "@tanstack/react-query";
import { getLeagueTeams, getLeagueMatchup, getLeagueMatchups, MatchupResult } from "../../lib/api";

const WEEKS = [21, 22, 23] as const;

const CATEGORIES: { key: string; label: string; lowerBetter?: boolean }[] = [
  { key: "pts",    label: "Points" },
  { key: "reb",    label: "Rebounds" },
  { key: "ast",    label: "Assists" },
  { key: "stl",    label: "Steals" },
  { key: "blk",    label: "Blocks" },
  { key: "tov",    label: "Turnovers", lowerBetter: true },
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
  const [yahooWeek, setYahooWeek] = useState<number>(1);
  const [teamA, setTeamA] = useState<string | null>(null);
  const [teamB, setTeamB] = useState<string | null>(null);
  const [menuA, setMenuA] = useState(false);
  const [menuB, setMenuB] = useState(false);

  const { data: teams } = useQuery({
    queryKey: ["league-teams"],
    queryFn: getLeagueTeams,
  });

  const { data: scheduledMatchups } = useQuery({
    queryKey: ["league-matchups", yahooWeek],
    queryFn: () => getLeagueMatchups(yahooWeek),
    retry: false,
  });

  const canFetch = !!teamA && !!teamB && teamA !== teamB;

  const { data: matchup, isLoading, error } = useQuery({
    queryKey: ["matchup", teamA, teamB, week],
    queryFn: () => getLeagueMatchup(teamA!, teamB!, week),
    enabled: canFetch,
  });

  const teamName = (key: string | null) =>
    teams?.find((t) => t.team_key === key)?.team_name ?? key ?? "—";

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={[styles.heading, { color: theme.colors.onBackground }]}>Matchup</Text>

        {/* Scheduled matchups from Yahoo */}
        {scheduledMatchups && scheduledMatchups.length > 0 && (
          <Surface style={styles.card} elevation={1}>
            <View style={styles.scheduledHeader}>
              <Text style={styles.cardTitle}>Scheduled Matchups</Text>
              <View style={styles.yahooWeekRow}>
                {[1, 2, 3].map((w) => (
                  <Chip
                    key={w}
                    selected={yahooWeek === w}
                    onPress={() => setYahooWeek(w)}
                    compact
                    style={styles.yahooWeekChip}
                  >
                    Wk {w}
                  </Chip>
                ))}
              </View>
            </View>
            <View style={styles.cardDivider} />
            {scheduledMatchups.map((m, idx) => (
              <View key={`${m.team_a_key}-${m.team_b_key}`}>
                <TouchableOpacity
                  style={styles.scheduledRow}
                  onPress={() => {
                    setTeamA(m.team_a_key);
                    setTeamB(m.team_b_key);
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={styles.scheduledTeam} numberOfLines={1}>{m.team_a_name}</Text>
                  <Text style={styles.scheduledVs}>vs</Text>
                  <Text style={[styles.scheduledTeam, styles.scheduledTeamRight]} numberOfLines={1}>
                    {m.team_b_name}
                  </Text>
                  <Text style={styles.scheduledArrow}>›</Text>
                </TouchableOpacity>
                {idx < scheduledMatchups.length - 1 && <Divider />}
              </View>
            ))}
          </Surface>
        )}

        {/* Week selector for projections */}
        <Text style={styles.sectionLabel}>Projection Week</Text>
        <View style={styles.weekRow}>
          {WEEKS.map((w) => (
            <Chip
              key={w}
              selected={week === w}
              onPress={() => setWeek(w)}
              compact
              style={styles.chip}
            >
              Wk {w}
            </Chip>
          ))}
        </View>

        {/* Team pickers */}
        {!teams || teams.length === 0 ? (
          <Text style={styles.hint}>No teams found. Run "Sync" on the Dashboard first.</Text>
        ) : (
          <View style={styles.pickerRow}>
            {/* Team A */}
            <View style={styles.pickerCol}>
              <Text style={styles.pickerLabel}>Team A</Text>
              <Menu
                visible={menuA}
                onDismiss={() => setMenuA(false)}
                anchor={
                  <Button
                    mode="outlined"
                    onPress={() => setMenuA(true)}
                    style={styles.pickerBtn}
                    contentStyle={styles.pickerBtnContent}
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

            {/* Team B */}
            <View style={styles.pickerCol}>
              <Text style={styles.pickerLabel}>Team B</Text>
              <Menu
                visible={menuB}
                onDismiss={() => setMenuB(false)}
                anchor={
                  <Button
                    mode="outlined"
                    onPress={() => setMenuB(true)}
                    style={styles.pickerBtn}
                    contentStyle={styles.pickerBtnContent}
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
        )}

        {teamA === teamB && teamA !== null && (
          <Text style={styles.errorText}>Select two different teams.</Text>
        )}

        {isLoading && <Text style={styles.hint}>Loading matchup…</Text>}
        {error && <Text style={styles.errorText}>{(error as Error).message}</Text>}

        {/* Matchup result */}
        {matchup && (
          <>
            {/* Summary */}
            <Surface style={[styles.card, styles.summaryCard]} elevation={2}>
              <View style={styles.summaryRow}>
                <View style={styles.summaryTeam}>
                  <Text style={styles.summaryTeamName} numberOfLines={2}>
                    {matchup.team_a}
                  </Text>
                  <Text style={styles.summaryWins}>{matchup.a_wins}</Text>
                </View>
                <View style={styles.summarySep}>
                  <Text style={styles.summaryLabel}>cats</Text>
                  {matchup.ties > 0 && (
                    <Text style={styles.tieText}>{matchup.ties} tie{matchup.ties !== 1 ? "s" : ""}</Text>
                  )}
                </View>
                <View style={styles.summaryTeam}>
                  <Text style={styles.summaryTeamName} numberOfLines={2}>
                    {matchup.team_b}
                  </Text>
                  <Text style={styles.summaryWins}>{matchup.b_wins}</Text>
                </View>
              </View>
            </Surface>

            {/* Category breakdown */}
            <Surface style={styles.card} elevation={1}>
              <View style={[styles.catRow, styles.catHeader]}>
                <Text style={[styles.catVal, styles.catHeaderText]}>
                  {matchup.team_a.split(" ").slice(-1)[0]}
                </Text>
                <Text style={[styles.catName, styles.catHeaderText]}>Category</Text>
                <Text style={[styles.catVal, styles.catHeaderText]}>
                  {matchup.team_b.split(" ").slice(-1)[0]}
                </Text>
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
                          <Text style={styles.arrowText}>
                            {aWins ? "◀" : "▶"}
                          </Text>
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
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, paddingBottom: 32, gap: 12 },
  heading: { fontSize: 24, fontWeight: "800", letterSpacing: -0.5, marginBottom: 4 },

  sectionLabel: { fontSize: 12, fontWeight: "600", color: "#888", textTransform: "uppercase", letterSpacing: 0.5 },
  weekRow: { flexDirection: "row", gap: 8 },
  chip: {},

  card: { borderRadius: 16, backgroundColor: "#fff", overflow: "hidden" },
  cardTitle: { fontSize: 15, fontWeight: "700", color: "#1a1a1a", padding: 16, paddingBottom: 10 },
  cardDivider: { height: StyleSheet.hairlineWidth, backgroundColor: "#f0f0f0", marginHorizontal: 16 },

  scheduledHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingRight: 12 },
  yahooWeekRow: { flexDirection: "row", gap: 6 },
  yahooWeekChip: {},
  scheduledRow: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 16, paddingVertical: 14, gap: 8,
  },
  scheduledTeam: { flex: 1, fontSize: 13, fontWeight: "600", color: "#1a1a1a" },
  scheduledTeamRight: { textAlign: "right" },
  scheduledVs: { fontSize: 11, color: "#aaa", fontWeight: "600" },
  scheduledArrow: { fontSize: 18, color: "#6750a4", marginLeft: 4 },

  pickerRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  pickerCol: { flex: 1 },
  pickerLabel: { fontSize: 11, color: "#888", marginBottom: 4, fontWeight: "600" },
  pickerBtn: { borderRadius: 10 },
  pickerBtnContent: {},
  vsText: { fontSize: 16, fontWeight: "700", color: "#aaa", marginTop: 20 },

  summaryCard: { padding: 16 },
  summaryRow: { flexDirection: "row", alignItems: "center" },
  summaryTeam: { flex: 1, alignItems: "center" },
  summaryTeamName: { fontSize: 13, fontWeight: "600", color: "#333", textAlign: "center", marginBottom: 4 },
  summaryWins: { fontSize: 36, fontWeight: "900", color: "#6750a4" },
  summarySep: { paddingHorizontal: 12, alignItems: "center" },
  summaryLabel: { fontSize: 12, color: "#888" },
  tieText: { fontSize: 11, color: "#aaa", marginTop: 4 },

  catRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12 },
  catHeader: { backgroundColor: "#f5f5f5" },
  catHeaderText: { fontWeight: "700", color: "#666", fontSize: 11 },
  catVal: { width: 64, fontSize: 14, color: "#555", textAlign: "left" },
  catValRight: { textAlign: "right" },
  catNameCol: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  catName: { fontSize: 13, fontWeight: "600", color: "#1a1a1a", textAlign: "center" },
  arrowText: { fontSize: 11, color: "#6750a4" },
  winnerText: { fontWeight: "800", color: "#2e7d32" },

  hint: { color: "#888", textAlign: "center", fontSize: 13 },
  errorText: { color: "#c62828", textAlign: "center", fontSize: 13 },
});
