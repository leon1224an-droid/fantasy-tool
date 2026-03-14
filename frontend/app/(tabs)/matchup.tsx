import React, { useState, useMemo, useEffect } from "react";
import { Modal, ScrollView, StyleSheet, View } from "react-native";
import { Chip, Divider, IconButton, Menu, Button, Surface, Text, useTheme } from "react-native-paper";
import { useQuery } from "@tanstack/react-query";
import { getLeagueTeams, getLeagueMatchup, MatchupResult, LeagueTeamResponse } from "../../lib/api";
import { useActiveTeam } from "../../lib/activeTeamContext";

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
  const { activeTeam } = useActiveTeam();
  const [week, setWeek] = useState<number>(21);
  const [teamA, setTeamA] = useState<string | null>(null);
  const [teamB, setTeamB] = useState<string | null>(null);
  const [menuA, setMenuA] = useState(false);
  const [menuB, setMenuB] = useState(false);

  // IL sets: player names excluded from each team's calculation
  const [ilA, setIlA] = useState<Set<string>>(new Set());
  const [ilB, setIlB] = useState<Set<string>>(new Set());

  // Which team's lineup modal is open
  const [lineupModal, setLineupModal] = useState<"a" | "b" | null>(null);

  const { data: teams } = useQuery({
    queryKey: ["league-teams"],
    queryFn: getLeagueTeams,
  });

  const teamData = (key: string | null) => teams?.find((t) => t.team_key === key) ?? null;
  const teamName = (key: string | null) => teamData(key)?.team_name ?? "Select team";

  const excludeA = useMemo(() => Array.from(ilA), [ilA]);
  const excludeB = useMemo(() => Array.from(ilB), [ilB]);

  const canFetch = !!teamA && !!teamB && teamA !== teamB;

  const { data: matchup, isLoading, error } = useQuery({
    queryKey: ["matchup", teamA, teamB, week, excludeA.sort().join(","), excludeB.sort().join(",")],
    queryFn: () => getLeagueMatchup(teamA!, teamB!, week, excludeA, excludeB),
    enabled: canFetch,
  });

  const yahooIL = (key: string): Set<string> =>
    new Set(teams?.find((t) => t.team_key === key)?.roster.filter((p) => p.is_il).map((p) => p.name) ?? []);

  const handleSelectA = (key: string) => { setTeamA(key); setIlA(yahooIL(key)); setMenuA(false); };
  const handleSelectB = (key: string) => { setTeamB(key); setIlB(yahooIL(key)); setMenuB(false); };

  // When a team is loaded in the Roster tab, auto-select it as Team A
  useEffect(() => {
    if (!activeTeam || !teams) return;
    handleSelectA(activeTeam.team_key);
  }, [activeTeam?.team_key, teams]);

  const activeTeam = lineupModal === "a" ? teamData(teamA) : teamData(teamB);
  const activeIl = lineupModal === "a" ? ilA : ilB;
  const setActiveIl = lineupModal === "a" ? setIlA : setIlB;

  const toggleIl = (name: string) => {
    setActiveIl((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {/* Lineup editor modal */}
      <Modal
        visible={lineupModal !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setLineupModal(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {activeTeam?.team_name ?? ""} — Set Lineup
              </Text>
              <IconButton icon="close" size={20} onPress={() => setLineupModal(null)} style={styles.modalClose} />
            </View>
            <Text style={styles.modalSub}>
              Yahoo IL players are pre-marked. Toggle to adjust who counts in the projection.
              Top 13 active players by projected value are used.
            </Text>
            <Divider style={styles.modalDivider} />
            <ScrollView style={styles.modalScroll}>
              {(activeTeam?.roster ?? []).map((player) => {
                const isIl = activeIl.has(player.name);
                return (
                  <View key={player.name} style={styles.playerRow}>
                    <View style={styles.playerInfo}>
                      <Text style={styles.playerName}>{player.name}</Text>
                      <Text style={styles.playerMeta}>{player.team} · {player.positions.join("/")}</Text>
                    </View>
                    <Chip
                      selected={isIl}
                      onPress={() => toggleIl(player.name)}
                      compact
                      showSelectedOverlay
                      selectedColor="#c62828"
                      style={[styles.ilChip, isIl && styles.ilChipActive]}
                      textStyle={[styles.ilChipText, isIl && styles.ilChipTextActive]}
                    >
                      IL
                    </Chip>
                  </View>
                );
              })}
            </ScrollView>
            <View style={styles.modalFooter}>
              <Text style={[
                styles.modalCount,
                (activeTeam?.roster.length ?? 0) - activeIl.size > 13 && { color: "#c62828" },
              ]}>
                {(activeTeam?.roster.length ?? 0) - activeIl.size} active{" "}
                {(activeTeam?.roster.length ?? 0) - activeIl.size > 13 ? `(need ${((activeTeam?.roster.length ?? 0) - activeIl.size) - 13} more IL)` : "✓"}
                {activeIl.size > 0 ? ` · ${activeIl.size} IL` : ""}
              </Text>
              <Button mode="contained" onPress={() => setLineupModal(null)} style={styles.modalDone}>
                Done
              </Button>
            </View>
          </View>
        </View>
      </Modal>

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
              Wk {w}
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
              {/* Team A */}
              <View style={styles.pickerCol}>
                <Menu
                  visible={menuA}
                  onDismiss={() => setMenuA(false)}
                  anchor={
                    <Button mode="outlined" onPress={() => setMenuA(true)} style={styles.pickerBtn} labelStyle={styles.pickerBtnLabel}>
                      {teamName(teamA)}
                    </Button>
                  }
                >
                  {teams.map((t) => (
                    <Menu.Item key={t.team_key} title={t.team_name} onPress={() => handleSelectA(t.team_key)} />
                  ))}
                </Menu>
                {teamA && (
                  <Button
                    mode="text"
                    compact
                    icon="account-edit"
                    onPress={() => setLineupModal("a")}
                    labelStyle={styles.editBtnLabel}
                  >
                    Edit lineup{ilA.size > 0 ? ` (${ilA.size} IL)` : ""}
                  </Button>
                )}
              </View>

              <Text style={styles.vsText}>vs</Text>

              {/* Team B */}
              <View style={styles.pickerCol}>
                <Menu
                  visible={menuB}
                  onDismiss={() => setMenuB(false)}
                  anchor={
                    <Button mode="outlined" onPress={() => setMenuB(true)} style={styles.pickerBtn} labelStyle={styles.pickerBtnLabel}>
                      {teamName(teamB)}
                    </Button>
                  }
                >
                  {teams.map((t) => (
                    <Menu.Item key={t.team_key} title={t.team_name} onPress={() => handleSelectB(t.team_key)} />
                  ))}
                </Menu>
                {teamB && (
                  <Button
                    mode="text"
                    compact
                    icon="account-edit"
                    onPress={() => setLineupModal("b")}
                    labelStyle={styles.editBtnLabel}
                  >
                    Edit lineup{ilB.size > 0 ? ` (${ilB.size} IL)` : ""}
                  </Button>
                )}
              </View>
            </View>
          </>
        )}

        {teamA === teamB && teamA !== null && (
          <Text style={styles.errorText}>Select two different teams.</Text>
        )}

        {/* Over-cap warnings */}
        {teamA && (() => {
          const count = (teamData(teamA)?.roster.length ?? 0) - ilA.size;
          return count > 13 ? (
            <View style={styles.overCapBanner}>
              <Text style={styles.overCapTitle}>⚠ Team A: {count} active players — max 13</Text>
              <Text style={styles.overCapHint}>
                Tap "Edit lineup" under Team A and move {count - 13} player{count - 13 > 1 ? "s" : ""} to IL so exactly 13 are active.
              </Text>
            </View>
          ) : null;
        })()}
        {teamB && (() => {
          const count = (teamData(teamB)?.roster.length ?? 0) - ilB.size;
          return count > 13 ? (
            <View style={styles.overCapBanner}>
              <Text style={styles.overCapTitle}>⚠ Team B: {count} active players — max 13</Text>
              <Text style={styles.overCapHint}>
                Tap "Edit lineup" under Team B and move {count - 13} player{count - 13 > 1 ? "s" : ""} to IL so exactly 13 are active.
              </Text>
            </View>
          ) : null;
        })()}

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

      <Surface style={styles.card} elevation={1}>
        <View style={[styles.catRow, styles.catHeader]}>
          <Text style={[styles.catVal, styles.catHeaderText]} numberOfLines={1}>{nameA}</Text>
          <View style={styles.catNameCol}>
            <Text style={[styles.catName, styles.catHeaderText]}>Category</Text>
          </View>
          <Text style={[styles.catVal, styles.catValRight, styles.catHeaderText]} numberOfLines={1}>{nameB}</Text>
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
                  {aWins && <Text style={styles.arrowText}>◀</Text>}
                  <Text style={styles.catName}>{meta?.label ?? cat.category}</Text>
                  {bWins && <Text style={styles.arrowText}>▶</Text>}
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

  pickerRow: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  pickerCol: { flex: 1, gap: 2 },
  pickerBtn: { borderRadius: 10 },
  pickerBtnLabel: { fontSize: 12, flexShrink: 1 },
  vsText: { fontSize: 15, fontWeight: "700", color: "#aaa", marginTop: 10 },
  editBtnLabel: { fontSize: 11, color: "#6750a4" },

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
  catVal: { width: 64, fontSize: 14, color: "#555", textAlign: "left" },
  catValRight: { textAlign: "right" },
  catNameCol: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  catName: { fontSize: 13, fontWeight: "600", color: "#1a1a1a", textAlign: "center" },
  arrowText: { fontSize: 11, color: "#6750a4" },
  winnerText: { fontWeight: "800", color: "#2e7d32" },

  hint: { color: "#888", textAlign: "center", fontSize: 13 },
  errorText: { color: "#c62828", textAlign: "center", fontSize: 13 },
  overCapBanner: { padding: 12, backgroundColor: "#fff3e0", borderRadius: 10, borderLeftWidth: 3, borderLeftColor: "#e65100" },
  overCapTitle: { fontSize: 13, fontWeight: "700", color: "#bf360c", marginBottom: 3 },
  overCapHint: { fontSize: 12, color: "#7f3300", lineHeight: 17 },

  // Lineup modal
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  modalBox: {
    backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingTop: 4, paddingBottom: 32, maxHeight: "80%",
  },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingLeft: 20, paddingRight: 8, paddingTop: 12 },
  modalTitle: { fontSize: 15, fontWeight: "700", color: "#1a1a1a", flex: 1 },
  modalClose: { margin: 0 },
  modalSub: { fontSize: 12, color: "#888", paddingHorizontal: 20, marginBottom: 8 },
  modalDivider: { marginBottom: 4 },
  modalScroll: { flexGrow: 0 },

  playerRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#f0f0f0",
  },
  playerInfo: { flex: 1, marginRight: 12 },
  playerName: { fontSize: 13, fontWeight: "600", color: "#1a1a1a" },
  playerMeta: { fontSize: 11, color: "#888", marginTop: 1 },
  ilChip: { height: 28 },
  ilChipActive: { backgroundColor: "#ffebee" },
  ilChipText: { fontSize: 11, color: "#888" },
  ilChipTextActive: { color: "#c62828", fontWeight: "700" },

  modalFooter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingTop: 14 },
  modalCount: { fontSize: 13, color: "#555", fontWeight: "600" },
  modalDone: { borderRadius: 10 },
});
