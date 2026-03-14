import React, { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { Chip, Divider, List, Surface, Text, useTheme } from "react-native-paper";
import { useQuery } from "@tanstack/react-query";
import { getLeagueRankings, getLeagueTeams, getAllSchedule, TeamRankingResponse, ScheduleRow } from "../../lib/api";

const WEEKS = [21, 22, 23] as const;
const WEEK_LABELS: Record<number, string> = {
  21: "Wk 21",
  22: "Wk 22",
  23: "Wk 23",
};

const CAT_COLS: { key: keyof TeamRankingResponse; label: string }[] = [
  { key: "pts",  label: "PTS" },
  { key: "reb",  label: "REB" },
  { key: "ast",  label: "AST" },
  { key: "stl",  label: "STL" },
  { key: "blk",  label: "BLK" },
  { key: "tov",  label: "TOV" },
  { key: "tpm",  label: "3PM" },
];

// Fixed column widths for horizontal-scrollable table
const COL = {
  rank: 28,
  name: 120,
  gp: 40,
  num: 48,
};

type Tab = "rankings" | "teams";

export default function LeagueScreen() {
  const theme = useTheme();
  const [week, setWeek] = useState<number>(21);
  const [tab, setTab] = useState<Tab>("rankings");
  const [expandedTeam, setExpandedTeam] = useState<string | null>(null);

  const { data: rankings, isLoading: rankLoading, error: rankError } = useQuery({
    queryKey: ["league-rankings", week],
    queryFn: () => getLeagueRankings(week),
    enabled: tab === "rankings",
  });

  const { data: teams, isLoading: teamsLoading, error: teamsError } = useQuery({
    queryKey: ["league-teams"],
    queryFn: getLeagueTeams,
    enabled: tab === "teams",
  });

  const { data: scheduleData } = useQuery({
    queryKey: ["schedule-all"],
    queryFn: getAllSchedule,
    enabled: tab === "teams",
  });

  // {nbaTeam: {21: n, 22: n, 23: n}}
  const gamesMap = React.useMemo(() => {
    const map: Record<string, Record<number, number>> = {};
    for (const row of scheduleData ?? []) {
      if (!map[row.team]) map[row.team] = {};
      map[row.team][row.week_num] = row.games_count;
    }
    return map;
  }, [scheduleData]);

  const isLoading = tab === "rankings" ? rankLoading : teamsLoading;
  const error = tab === "rankings" ? rankError : teamsError;

  // Total fixed table width for horizontal scroll
  const tableWidth = COL.rank + COL.name + COL.gp + CAT_COLS.length * COL.num;

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={[styles.heading, { color: theme.colors.onBackground }]}>League</Text>

        {/* Tab toggle */}
        <View style={styles.tabRow}>
          {(["rankings", "teams"] as Tab[]).map((t) => (
            <Chip
              key={t}
              selected={tab === t}
              onPress={() => setTab(t)}
              style={styles.tabChip}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </Chip>
          ))}
        </View>

        {/* Week selector (only for rankings) */}
        {tab === "rankings" && (
          <View style={styles.weekRow}>
            {WEEKS.map((w) => (
              <Chip
                key={w}
                selected={week === w}
                onPress={() => setWeek(w)}
                style={styles.weekChip}
                compact
              >
                {WEEK_LABELS[w]}
              </Chip>
            ))}
          </View>
        )}

        {isLoading && <Text style={styles.hint}>Loading…</Text>}
        {error && (
          <Text style={styles.errorText}>
            {(error as Error).message.includes("404")
              ? "No league data. Run POST /ingest/yahoo-league first."
              : (error as Error).message}
          </Text>
        )}

        {/* Rankings table — horizontal scroll */}
        {tab === "rankings" && rankings && rankings.length > 0 && (
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator={true} style={styles.tableScrollH}>
              <Surface style={[styles.card, { width: tableWidth }]} elevation={1}>
                {/* Header */}
                <View style={[styles.tableRow, styles.tableHeader]}>
                  <Text style={[styles.cell, { width: COL.rank }, styles.headerText]}>#</Text>
                  <Text style={[styles.cell, { width: COL.name }, styles.headerText]}>Team</Text>
                  <Text style={[styles.cell, { width: COL.gp }, styles.headerText, { textAlign: "right" }]}>GP</Text>
                  {CAT_COLS.map((c) => (
                    <Text key={c.key} style={[styles.cell, { width: COL.num }, styles.headerText, { textAlign: "right" }]}>
                      {c.label}
                    </Text>
                  ))}
                </View>
                <Divider />
                {rankings.map((r, idx) => (
                  <View key={r.team_key}>
                    <View style={styles.tableRow}>
                      <Text style={[styles.cell, { width: COL.rank }, styles.rankText]}>{r.rank}</Text>
                      <Text style={[styles.cell, { width: COL.name }]} numberOfLines={1}>
                        {r.team_name}
                      </Text>
                      <Text style={[styles.cell, { width: COL.gp }, { textAlign: "right" }]}>{r.total_games}</Text>
                      {CAT_COLS.map((c) => (
                        <Text key={c.key} style={[styles.cell, { width: COL.num }, { textAlign: "right" }]}>
                          {typeof r[c.key] === "number"
                            ? (r[c.key] as number).toFixed(c.key === "fg_pct" || c.key === "ft_pct" ? 3 : 1)
                            : r[c.key]}
                        </Text>
                      ))}
                    </View>
                    {idx < rankings.length - 1 && <Divider />}
                  </View>
                ))}
              </Surface>
            </ScrollView>
            <Text style={styles.tableNote}>
              GP = player-game starts this week · Scroll right for stats →
            </Text>
          </>
        )}

        {/* Teams list */}
        {tab === "teams" && teams && teams.length === 0 && (
          <Text style={styles.hint}>No teams found. Run POST /ingest/yahoo-league first.</Text>
        )}
        {tab === "teams" && teams && teams.length > 0 && (
          <Surface style={styles.card} elevation={1}>
            {teams.map((team, idx) => (
              <View key={team.team_key}>
                <List.Accordion
                  title={team.team_name}
                  description={team.manager_name ? `Manager: ${team.manager_name}` : undefined}
                  expanded={expandedTeam === team.team_key}
                  onPress={() =>
                    setExpandedTeam(expandedTeam === team.team_key ? null : team.team_key)
                  }
                  left={(props) => <List.Icon {...props} icon="account-group" />}
                >
                  {team.roster.length === 0 ? (
                    <List.Item title="No roster data" />
                  ) : (
                    team.roster.map((p) => {
                      const g = gamesMap[p.team] ?? {};
                      const gameParts = ([21, 22, 23] as const)
                        .map((w) => `W${w - 20}:${g[w] ?? 0}`)
                        .join("  ");
                      return (
                        <List.Item
                          key={p.name}
                          title={p.name}
                          titleStyle={[styles.rosterPlayerName, p.is_il && styles.ilPlayerName]}
                          description={`${p.is_il ? "IL · " : ""}${p.team} · ${p.positions.join("/")}   ${gameParts}`}
                          descriptionStyle={[styles.rosterPlayerDesc, p.is_il && styles.ilPlayerDesc]}
                          descriptionNumberOfLines={2}
                          left={(props) => (
                            <List.Icon
                              {...props}
                              icon={p.is_il ? "medical-bag" : "basketball"}
                              color={p.is_il ? "#e65100" : undefined}
                            />
                          )}
                        />
                      );
                    })
                  )}
                </List.Accordion>
                {idx < teams.length - 1 && <Divider />}
              </View>
            ))}
          </Surface>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, paddingBottom: 32, gap: 12 },
  heading: { fontSize: 18, fontWeight: "700", letterSpacing: -0.3, marginBottom: 4 },

  tabRow: { flexDirection: "row", gap: 8 },
  tabChip: {},
  weekRow: { flexDirection: "row", gap: 8 },
  weekChip: {},

  card: { borderRadius: 16, backgroundColor: "#fff", overflow: "hidden" },
  tableScrollH: { marginHorizontal: -2 },

  tableRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 11 },
  tableHeader: { backgroundColor: "#f5f5f5" },
  headerText: { fontWeight: "700", color: "#555", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.3 },

  cell: { fontSize: 13, color: "#1a1a1a" },
  rankText: { fontWeight: "700", color: "#6750a4", textAlign: "center" },
  tableNote: { fontSize: 11, color: "#999", textAlign: "center", paddingHorizontal: 8 },

  hint: { color: "#888", textAlign: "center", fontSize: 13 },
  errorText: { color: "#c62828", textAlign: "center", fontSize: 13 },

  rosterPlayerName: { fontSize: 13, fontWeight: "600" },
  rosterPlayerDesc: { fontSize: 11, color: "#888" },
  ilPlayerName: { color: "#e65100" },
  ilPlayerDesc: { color: "#bf360c" },
});
