/**
 * Compare two rosters side-by-side by total games per week.
 * Each side can hold any set of players. Games come from /schedule/all,
 * keyed by team. Players are picked from the active roster OR searched.
 */
import React, { useState, useMemo, useCallback } from "react";
import { ScrollView, StyleSheet, TouchableOpacity, View } from "react-native";
import {
  ActivityIndicator,
  IconButton,
  Searchbar,
  Surface,
  Text,
  useTheme,
} from "react-native-paper";
import { useQuery } from "@tanstack/react-query";
import {
  getAllSchedule,
  getRoster,
  searchPlayers,
  getPlayerInfo,
  NBAPlayerSearchResult,
  ScheduleRow,
} from "../../lib/api";

const WEEKS = [21, 22, 23] as const;

// ---- Types ----------------------------------------------------------------
interface ComparePlayer {
  name: string;
  team: string;
}

// ---- Main screen ----------------------------------------------------------
export default function CompareScreen() {
  const theme = useTheme();

  const [rosterA, setRosterA] = useState<ComparePlayer[]>([]);
  const [rosterB, setRosterB] = useState<ComparePlayer[]>([]);

  const { data: allSchedule, isLoading: schedLoading } = useQuery({
    queryKey: ["schedule-all"],
    queryFn: getAllSchedule,
  });

  // Build team → week → games lookup
  const gamesLookup = useMemo(() => {
    const map: Record<string, Record<number, number>> = {};
    if (!allSchedule) return map;
    for (const row of allSchedule) {
      if (!map[row.team]) map[row.team] = {};
      map[row.team][row.week_num] = row.games_count;
    }
    return map;
  }, [allSchedule]);

  const weekGames = (team: string, week: number) =>
    gamesLookup[team]?.[week] ?? 0;

  const rosterTotal = (roster: ComparePlayer[], week: number) =>
    roster.reduce((s, p) => s + weekGames(p.team, week), 0);

  const grandTotal = (roster: ComparePlayer[]) =>
    WEEKS.reduce((s, w) => s + rosterTotal(roster, w), 0);

  const removeA = (name: string) => setRosterA((r) => r.filter((p) => p.name !== name));
  const removeB = (name: string) => setRosterB((r) => r.filter((p) => p.name !== name));

  const addToA = (p: ComparePlayer) => {
    if (!rosterA.find((x) => x.name === p.name)) setRosterA((r) => [...r, p]);
  };
  const addToB = (p: ComparePlayer) => {
    if (!rosterB.find((x) => x.name === p.name)) setRosterB((r) => [...r, p]);
  };

  const totA = WEEKS.map((w) => rosterTotal(rosterA, w));
  const totB = WEEKS.map((w) => rosterTotal(rosterB, w));
  const grandA = grandTotal(rosterA);
  const grandB = grandTotal(rosterB);

  if (schedLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
        <Text style={styles.loadingText}>Loading schedule…</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.colors.background }]}
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
    >
      {/* Totals comparison bar */}
      {(rosterA.length > 0 || rosterB.length > 0) && (
        <Surface style={styles.comparisonBar} elevation={1}>
          <ComparisonRow
            label="Week 21"
            a={totA[0]}
            b={totB[0]}
            aCount={rosterA.length}
            bCount={rosterB.length}
          />
          <ComparisonRow
            label="Week 22"
            a={totA[1]}
            b={totB[1]}
            aCount={rosterA.length}
            bCount={rosterB.length}
          />
          <ComparisonRow
            label="Week 23"
            a={totA[2]}
            b={totB[2]}
            aCount={rosterA.length}
            bCount={rosterB.length}
          />
          <View style={styles.barDivider} />
          <ComparisonRow
            label="Total"
            a={grandA}
            b={grandB}
            aCount={rosterA.length}
            bCount={rosterB.length}
            isTotal
          />
        </Surface>
      )}

      {/* Side-by-side roster panels */}
      <View style={styles.rostersRow}>
        <RosterPanel
          side="A"
          color="#6750a4"
          players={rosterA}
          onRemove={removeA}
          onAdd={addToA}
          otherNames={new Set(rosterB.map((p) => p.name))}
          gamesLookup={gamesLookup}
        />
        <RosterPanel
          side="B"
          color="#c2185b"
          players={rosterB}
          onRemove={removeB}
          onAdd={addToB}
          otherNames={new Set(rosterA.map((p) => p.name))}
          gamesLookup={gamesLookup}
        />
      </View>

      {rosterA.length === 0 && rosterB.length === 0 && (
        <Text style={styles.hint}>
          Add players to Roster A and B to compare their playoff game totals.
        </Text>
      )}
    </ScrollView>
  );
}

// ---- Comparison row -------------------------------------------------------
function ComparisonRow({
  label, a, b, aCount, bCount, isTotal,
}: {
  label: string; a: number; b: number; aCount: number; bCount: number; isTotal?: boolean;
}) {
  const diff = a - b;
  const aWins = aCount > 0 && bCount > 0 && diff > 0;
  const bWins = aCount > 0 && bCount > 0 && diff < 0;

  return (
    <View style={[styles.compRow, isTotal && styles.compRowTotal]}>
      <Text style={[styles.compValue, { color: "#6750a4" }, aWins && styles.winnerText]}>
        {a}
      </Text>
      <View style={styles.compMid}>
        <Text style={[styles.compLabel, isTotal && styles.compLabelBold]}>{label}</Text>
        {aCount > 0 && bCount > 0 && diff !== 0 && (
          <Text style={[styles.diffText, { color: aWins ? "#6750a4" : "#c2185b" }]}>
            {aWins ? `A +${diff}` : `B +${Math.abs(diff)}`}
          </Text>
        )}
      </View>
      <Text style={[styles.compValue, { color: "#c2185b" }, bWins && styles.winnerText]}>
        {b}
      </Text>
    </View>
  );
}

// ---- Roster panel ---------------------------------------------------------
function RosterPanel({
  side, color, players, onRemove, onAdd, otherNames, gamesLookup,
}: {
  side: "A" | "B";
  color: string;
  players: ComparePlayer[];
  onRemove: (name: string) => void;
  onAdd: (p: ComparePlayer) => void;
  otherNames: Set<string>;
  gamesLookup: Record<string, Record<number, number>>;
}) {
  const [showSearch, setShowSearch] = useState(false);
  const myNames = new Set(players.map((p) => p.name));

  return (
    <Surface style={[styles.panel, { borderTopColor: color, borderTopWidth: 3 }]} elevation={1}>
      {/* Panel header */}
      <View style={[styles.panelHeader, { backgroundColor: color + "12" }]}>
        <Text style={[styles.panelTitle, { color }]}>Roster {side}</Text>
        <IconButton
          icon={showSearch ? "minus-circle-outline" : "plus-circle-outline"}
          iconColor={color}
          size={20}
          style={styles.panelAddBtn}
          onPress={() => setShowSearch((v) => !v)}
        />
      </View>

      {/* Search/add */}
      {showSearch && (
        <PlayerPicker
          color={color}
          excludeNames={myNames}
          onSelect={(p) => {
            onAdd(p);
            setShowSearch(false);
          }}
        />
      )}

      {/* Player list */}
      {players.length === 0 && !showSearch && (
        <Text style={styles.emptyPanel}>Tap + to add players</Text>
      )}

      {players.map((p) => {
        const games = WEEKS.map((w) => gamesLookup[p.team]?.[w] ?? 0);
        const total = games.reduce((s, g) => s + g, 0);
        const isShared = otherNames.has(p.name);
        return (
          <View key={p.name} style={styles.playerRow}>
            <View style={styles.playerInfo}>
              <Text style={styles.playerName} numberOfLines={1}>{p.name}</Text>
              <Text style={styles.playerMeta}>
                {p.team} · {games.join("-")} ({total}G)
              </Text>
            </View>
            <IconButton
              icon="close"
              size={16}
              iconColor="#999"
              onPress={() => onRemove(p.name)}
              style={styles.removeBtn}
            />
          </View>
        );
      })}

      {/* Per-week subtotals */}
      {players.length > 0 && (
        <View style={[styles.panelTotals, { backgroundColor: color + "10" }]}>
          {WEEKS.map((w) => {
            const t = players.reduce((s, p) => s + (gamesLookup[p.team]?.[w] ?? 0), 0);
            return (
              <View key={w} style={styles.panelTotalCell}>
                <Text style={[styles.panelTotalVal, { color }]}>{t}</Text>
                <Text style={styles.panelTotalLbl}>Wk {w}</Text>
              </View>
            );
          })}
          <View style={styles.panelTotalCell}>
            <Text style={[styles.panelTotalVal, { color }]}>
              {WEEKS.reduce((s, w) => s + players.reduce((ss, p) => ss + (gamesLookup[p.team]?.[w] ?? 0), 0), 0)}
            </Text>
            <Text style={styles.panelTotalLbl}>Total</Text>
          </View>
        </View>
      )}
    </Surface>
  );
}

// ---- Player picker --------------------------------------------------------
function PlayerPicker({
  color,
  excludeNames,
  onSelect,
}: {
  color: string;
  excludeNames: Set<string>;
  onSelect: (p: ComparePlayer) => void;
}) {
  const [query, setQuery] = useState("");
  const [loadingId, setLoadingId] = useState<number | null>(null);

  const { data: roster } = useQuery({ queryKey: ["roster"], queryFn: getRoster });

  const { data: searchResults, isFetching: searching } = useQuery({
    queryKey: ["players-search", query],
    queryFn: () => (query.length >= 2 ? searchPlayers(query) : Promise.resolve([])),
    enabled: query.length >= 2,
  });

  // Roster players filtered by query
  const rosterMatches = useMemo(() => {
    if (!roster) return [];
    const q = query.toLowerCase();
    return roster.filter(
      (p) => !excludeNames.has(p.name) && p.name.toLowerCase().includes(q)
    );
  }, [roster, query, excludeNames]);

  // Search results (non-roster players)
  const rosterNames = new Set(roster?.map((p) => p.name) ?? []);
  const externalResults: NBAPlayerSearchResult[] = (searchResults ?? []).filter(
    (r) => !rosterNames.has(r.name) && !excludeNames.has(r.name)
  );

  const handlePickFromRoster = useCallback(
    (name: string, team: string) => {
      onSelect({ name, team });
      setQuery("");
    },
    [onSelect]
  );

  const handlePickExternal = useCallback(
    async (result: NBAPlayerSearchResult) => {
      setLoadingId(result.player_id);
      try {
        const info = await getPlayerInfo(result.player_id);
        onSelect({ name: info.name, team: info.team });
        setQuery("");
      } finally {
        setLoadingId(null);
      }
    },
    [onSelect]
  );

  return (
    <View style={styles.pickerPanel}>
      <Searchbar
        placeholder="Name or search…"
        value={query}
        onChangeText={setQuery}
        style={[styles.pickerSearch, { borderColor: color + "50" }]}
        loading={searching}
        elevation={0}
      />

      {/* From active roster */}
      {rosterMatches.slice(0, 6).map((p) => (
        <TouchableOpacity
          key={p.name}
          style={styles.pickerRow}
          onPress={() => handlePickFromRoster(p.name, p.team)}
          activeOpacity={0.6}
        >
          <View>
            <Text style={styles.pickerName}>{p.name}</Text>
            <Text style={styles.pickerMeta}>{p.team} · roster</Text>
          </View>
          <IconButton icon="plus" size={14} iconColor={color} style={styles.pickerPlusBtn} />
        </TouchableOpacity>
      ))}

      {/* From NBA-wide search (non-roster) */}
      {query.length >= 2 &&
        externalResults.slice(0, 4).map((r) => (
          <TouchableOpacity
            key={r.player_id}
            style={styles.pickerRow}
            onPress={() => handlePickExternal(r)}
            activeOpacity={0.6}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.pickerName}>{r.name}</Text>
              <Text style={styles.pickerMeta}>NBA search</Text>
            </View>
            {loadingId === r.player_id ? (
              <ActivityIndicator size={14} style={styles.pickerPlusBtn} />
            ) : (
              <IconButton icon="plus" size={14} iconColor={color} style={styles.pickerPlusBtn} />
            )}
          </TouchableOpacity>
        ))}
    </View>
  );
}

// ---- Styles ---------------------------------------------------------------
const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 40, gap: 12 },
  center: { flex: 1, justifyContent: "center", alignItems: "center", gap: 12 },
  loadingText: { color: "#888" },
  hint: { color: "#aaa", textAlign: "center", fontSize: 13, marginTop: 8 },

  // Comparison bar
  comparisonBar: { borderRadius: 14, backgroundColor: "#fff", overflow: "hidden", marginBottom: 4 },
  compRow: { flexDirection: "row", alignItems: "center", paddingVertical: 10, paddingHorizontal: 16 },
  compRowTotal: { backgroundColor: "#fafafa" },
  compValue: { fontSize: 22, fontWeight: "800", width: 44, textAlign: "center" },
  compMid: { flex: 1, alignItems: "center" },
  compLabel: { fontSize: 13, color: "#555" },
  compLabelBold: { fontWeight: "700", color: "#1a1a1a" },
  diffText: { fontSize: 11, fontWeight: "700", marginTop: 2 },
  winnerText: { fontSize: 26 },
  barDivider: { height: StyleSheet.hairlineWidth, backgroundColor: "#e0e0e0", marginHorizontal: 16 },

  // Roster panels
  rostersRow: { flexDirection: "row", gap: 10 },
  panel: { flex: 1, borderRadius: 14, backgroundColor: "#fff", overflow: "hidden" },
  panelHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingLeft: 14, paddingVertical: 4 },
  panelTitle: { fontSize: 15, fontWeight: "800" },
  panelAddBtn: { margin: 0 },
  emptyPanel: { color: "#bbb", textAlign: "center", paddingVertical: 20, fontSize: 12 },

  playerRow: { flexDirection: "row", alignItems: "center", paddingLeft: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#f0f0f0" },
  playerInfo: { flex: 1, paddingVertical: 8 },
  playerName: { fontSize: 12, fontWeight: "600", color: "#1a1a1a" },
  playerMeta: { fontSize: 10, color: "#888", marginTop: 1 },
  removeBtn: { margin: 0, width: 28, height: 28 },

  panelTotals: { flexDirection: "row", paddingVertical: 10 },
  panelTotalCell: { flex: 1, alignItems: "center" },
  panelTotalVal: { fontSize: 16, fontWeight: "800" },
  panelTotalLbl: { fontSize: 9, color: "#888", textTransform: "uppercase", letterSpacing: 0.3 },

  // Player picker
  pickerPanel: { paddingHorizontal: 10, paddingBottom: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#f0f0f0" },
  pickerSearch: { marginBottom: 4, backgroundColor: "#f5f5f5", height: 38, borderRadius: 10 },
  pickerRow: { flexDirection: "row", alignItems: "center", paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#f8f8f8" },
  pickerName: { fontSize: 12, fontWeight: "600", color: "#1a1a1a" },
  pickerMeta: { fontSize: 10, color: "#888" },
  pickerPlusBtn: { margin: 0, width: 24, height: 24 },
});
