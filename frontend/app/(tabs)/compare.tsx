/**
 * Compare two rosters side-by-side by playable starts per week.
 * Uses the /simulate-schedule endpoint to account for position constraints.
 */
import React, { useState, useMemo, useCallback } from "react";
import { Modal, ScrollView, StyleSheet, TouchableOpacity, View } from "react-native";
import {
  ActivityIndicator,
  Divider,
  IconButton,
  Searchbar,
  Surface,
  Text,
  useTheme,
} from "react-native-paper";
import { useQuery } from "@tanstack/react-query";
import {
  getRoster,
  getSavedRosters,
  getLeagueTeams,
  searchPlayers,
  getPlayerInfo,
  simulateSchedule,
  NBAPlayerSearchResult,
  SavedRosterSchema,
  SimulateScheduleResponse,
  LeagueTeamResponse,
} from "../../lib/api";

const WEEKS = [21, 22, 23] as const;

interface ComparePlayer {
  name: string;
  team: string;
  positions: string[];
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------
export default function CompareScreen() {
  const theme = useTheme();

  const [rosterA, setRosterA] = useState<ComparePlayer[]>([]);
  const [rosterB, setRosterB] = useState<ComparePlayer[]>([]);

  // Stable keys so the query only re-runs when roster actually changes
  const keyA = rosterA.map((p) => p.name).sort().join(",");
  const keyB = rosterB.map((p) => p.name).sort().join(",");

  const { data: simA, isFetching: loadingA } = useQuery({
    queryKey: ["simulate", keyA],
    queryFn: () => simulateSchedule(rosterA),
    enabled: rosterA.length > 0,
    staleTime: 60_000,
  });

  const { data: simB, isFetching: loadingB } = useQuery({
    queryKey: ["simulate", keyB],
    queryFn: () => simulateSchedule(rosterB),
    enabled: rosterB.length > 0,
    staleTime: 60_000,
  });

  // Build {playerName: {weekNum: starts}} lookups from simulation results
  const startsMapA = useMemo(() => buildStartsMap(simA), [simA]);
  const startsMapB = useMemo(() => buildStartsMap(simB), [simB]);

  const weekTotalA = (w: number) =>
    rosterA.reduce((s, p) => s + (startsMapA[p.name]?.[w] ?? 0), 0);
  const weekTotalB = (w: number) =>
    rosterB.reduce((s, p) => s + (startsMapB[p.name]?.[w] ?? 0), 0);
  const grandA = WEEKS.reduce((s, w) => s + weekTotalA(w), 0);
  const grandB = WEEKS.reduce((s, w) => s + weekTotalB(w), 0);

  const removeA = (name: string) => setRosterA((r) => r.filter((p) => p.name !== name));
  const removeB = (name: string) => setRosterB((r) => r.filter((p) => p.name !== name));
  const addToA = (p: ComparePlayer) => {
    if (!rosterA.find((x) => x.name === p.name)) setRosterA((r) => [...r, p]);
  };
  const addToB = (p: ComparePlayer) => {
    if (!rosterB.find((x) => x.name === p.name)) setRosterB((r) => [...r, p]);
  };

  const loadSavedToA = (roster: SavedRosterSchema) =>
    setRosterA(roster.players.map((p) => ({ name: p.name, team: p.team, positions: p.positions ?? [] })));
  const loadSavedToB = (roster: SavedRosterSchema) =>
    setRosterB(roster.players.map((p) => ({ name: p.name, team: p.team, positions: p.positions ?? [] })));

  const loadYahooToA = (team: LeagueTeamResponse) =>
    setRosterA(team.roster.map((p) => ({ name: p.name, team: p.team, positions: p.positions ?? [] })));
  const loadYahooToB = (team: LeagueTeamResponse) =>
    setRosterB(team.roster.map((p) => ({ name: p.name, team: p.team, positions: p.positions ?? [] })));

  const totA = WEEKS.map((w) => weekTotalA(w));
  const totB = WEEKS.map((w) => weekTotalB(w));

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.colors.background }]}
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
    >
      {/* Totals comparison bar */}
      {(rosterA.length > 0 || rosterB.length > 0) && (
        <Surface style={styles.comparisonBar} elevation={1}>
          {(loadingA || loadingB) && (
            <View style={styles.simLoading}>
              <ActivityIndicator size={14} />
              <Text style={styles.simLoadingText}>Simulating schedule…</Text>
            </View>
          )}
          {WEEKS.map((w, i) => (
            <ComparisonRow
              key={w}
              label={`Week ${w}`}
              a={totA[i]}
              b={totB[i]}
              hasData={rosterA.length > 0 && rosterB.length > 0}
            />
          ))}
          <View style={styles.barDivider} />
          <ComparisonRow
            label="Total"
            a={grandA}
            b={grandB}
            hasData={rosterA.length > 0 && rosterB.length > 0}
            isTotal
          />
          <Text style={styles.simNote}>Playable starts (position-constrained)</Text>
        </Surface>
      )}

      {/* Side-by-side panels */}
      <View style={styles.rostersRow}>
        <RosterPanel
          side="A"
          color="#6750a4"
          players={rosterA}
          onRemove={removeA}
          onAdd={addToA}
          onLoadSaved={loadSavedToA}
          onLoadYahoo={loadYahooToA}
          startsMap={startsMapA}
          isLoading={loadingA}
        />
        <RosterPanel
          side="B"
          color="#c2185b"
          players={rosterB}
          onRemove={removeB}
          onAdd={addToB}
          onLoadSaved={loadSavedToB}
          onLoadYahoo={loadYahooToB}
          startsMap={startsMapB}
          isLoading={loadingB}
        />
      </View>

      {rosterA.length === 0 && rosterB.length === 0 && (
        <Text style={styles.hint}>
          Add players or load a saved roster into each side to compare playable starts.
        </Text>
      )}
    </ScrollView>
  );
}

function buildStartsMap(sim: SimulateScheduleResponse | undefined): Record<string, Record<number, number>> {
  if (!sim) return {};
  const map: Record<string, Record<number, number>> = {};
  for (const p of sim.players) {
    map[p.name] = {};
    for (const w of p.weeks) {
      map[p.name][w.week_num] = w.starts;
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Comparison row
// ---------------------------------------------------------------------------
function ComparisonRow({
  label, a, b, hasData, isTotal,
}: {
  label: string; a: number; b: number; hasData: boolean; isTotal?: boolean;
}) {
  const aWins = hasData && a > b;
  const bWins = hasData && b > a;
  const diff = Math.abs(a - b);

  return (
    <View style={[styles.compRow, isTotal && styles.compRowTotal]}>
      <Text style={[styles.compValue, { color: "#6750a4" }, aWins && styles.compValueWinner]}>{a}</Text>
      <View style={styles.compMid}>
        <Text style={[styles.compLabel, isTotal && styles.compLabelTotal]}>{label}</Text>
        {hasData && diff > 0 && (
          <Text style={[styles.diffText, { color: aWins ? "#6750a4" : "#c2185b" }]}>
            {aWins ? `A +${diff}` : `B +${diff}`}
          </Text>
        )}
      </View>
      <Text style={[styles.compValue, { color: "#c2185b" }, bWins && styles.compValueWinner]}>{b}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Roster panel
// ---------------------------------------------------------------------------
function RosterPanel({
  side, color, players, onRemove, onAdd, onLoadSaved, onLoadYahoo, startsMap, isLoading,
}: {
  side: "A" | "B";
  color: string;
  players: ComparePlayer[];
  onRemove: (name: string) => void;
  onAdd: (p: ComparePlayer) => void;
  onLoadSaved: (roster: SavedRosterSchema) => void;
  onLoadYahoo: (team: LeagueTeamResponse) => void;
  startsMap: Record<string, Record<number, number>>;
  isLoading: boolean;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [showLoadModal, setShowLoadModal] = useState(false);

  return (
    <Surface style={[styles.panel, { borderTopColor: color, borderTopWidth: 3 }]} elevation={1}>
      {/* Panel header */}
      <View style={[styles.panelHeader, { backgroundColor: color + "12" }]}>
        <Text style={[styles.panelTitle, { color }]}>Roster {side}</Text>
        <View style={styles.panelHeaderActions}>
          <IconButton
            icon="bookmark-outline"
            size={18}
            iconColor={color}
            style={styles.panelActionBtn}
            onPress={() => { setShowLoadModal(true); setShowAdd(false); }}
          />
          <IconButton
            icon={showAdd ? "minus-circle-outline" : "plus-circle-outline"}
            iconColor={color}
            size={18}
            style={styles.panelActionBtn}
            onPress={() => { setShowAdd((v) => !v); setShowLoadModal(false); }}
          />
        </View>
      </View>

      {/* Search/add */}
      {showAdd && (
        <PlayerPicker
          color={color}
          excludeNames={new Set(players.map((p) => p.name))}
          onSelect={(p) => { onAdd(p); setShowAdd(false); }}
        />
      )}

      {/* Load roster modal (saved + Yahoo) */}
      <LoadRosterModal
        visible={showLoadModal}
        color={color}
        onClose={() => setShowLoadModal(false)}
        onLoadSaved={(r) => { onLoadSaved(r); setShowLoadModal(false); }}
        onLoadYahoo={(t) => { onLoadYahoo(t); setShowLoadModal(false); }}
      />

      {/* Empty state */}
      {players.length === 0 && !showAdd && (
        <Text style={styles.emptyPanel}>Tap + to add or bookmark to load saved</Text>
      )}

      {/* Player list */}
      {players.map((p) => {
        const weekStarts = WEEKS.map((w) => startsMap[p.name]?.[w] ?? (isLoading ? "…" : 0));
        const totalStarts = isLoading
          ? "…"
          : WEEKS.reduce((s, w) => s + (startsMap[p.name]?.[w] ?? 0), 0);
        return (
          <View key={p.name} style={styles.playerRow}>
            <View style={styles.playerInfo}>
              <Text style={styles.playerName} numberOfLines={1}>{p.name}</Text>
              <Text style={styles.playerMeta}>
                {p.team} · {weekStarts.join("-")} ({totalStarts}S)
              </Text>
            </View>
            <IconButton icon="close" size={16} iconColor="#bbb" onPress={() => onRemove(p.name)} style={styles.removeBtn} />
          </View>
        );
      })}

      {/* Per-week subtotals */}
      {players.length > 0 && (
        <View style={[styles.panelTotals, { backgroundColor: color + "10" }]}>
          {WEEKS.map((w) => {
            const t = players.reduce((s, p) => s + (startsMap[p.name]?.[w] ?? 0), 0);
            return (
              <View key={w} style={styles.panelTotalCell}>
                <Text style={[styles.panelTotalVal, { color }]}>{isLoading ? "…" : t}</Text>
                <Text style={styles.panelTotalLbl}>Wk{w}</Text>
              </View>
            );
          })}
          <View style={styles.panelTotalCell}>
            <Text style={[styles.panelTotalVal, { color }]}>
              {isLoading ? "…" : players.reduce(
                (s, p) => s + WEEKS.reduce((ss, w) => ss + (startsMap[p.name]?.[w] ?? 0), 0),
                0
              )}
            </Text>
            <Text style={styles.panelTotalLbl}>Total</Text>
          </View>
        </View>
      )}
    </Surface>
  );
}

// ---------------------------------------------------------------------------
// Load roster modal — tabs for Saved and Yahoo teams
// ---------------------------------------------------------------------------
function LoadRosterModal({
  visible, color, onClose, onLoadSaved, onLoadYahoo,
}: {
  visible: boolean;
  color: string;
  onClose: () => void;
  onLoadSaved: (r: SavedRosterSchema) => void;
  onLoadYahoo: (t: LeagueTeamResponse) => void;
}) {
  const [tab, setTab] = useState<"saved" | "yahoo">("saved");

  const { data: savedData, isLoading: savedLoading } = useQuery({
    queryKey: ["saved-rosters"],
    queryFn: getSavedRosters,
    enabled: visible && tab === "saved",
  });

  const { data: yahooData, isLoading: yahooLoading } = useQuery({
    queryKey: ["league-teams"],
    queryFn: getLeagueTeams,
    enabled: visible && tab === "yahoo",
  });

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1}>
          <Surface style={[styles.modalCard, { borderTopColor: color, borderTopWidth: 3 }]} elevation={4}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color }]}>Load Roster</Text>
              <IconButton icon="close" size={20} onPress={onClose} style={{ margin: 0 }} />
            </View>
            <Divider />

            {/* Tabs */}
            <View style={styles.modalTabs}>
              <TouchableOpacity
                style={[styles.modalTab, tab === "saved" && { borderBottomColor: color, borderBottomWidth: 2 }]}
                onPress={() => setTab("saved")}
              >
                <Text style={[styles.modalTabText, tab === "saved" && { color }]}>Saved</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalTab, tab === "yahoo" && { borderBottomColor: color, borderBottomWidth: 2 }]}
                onPress={() => setTab("yahoo")}
              >
                <Text style={[styles.modalTabText, tab === "yahoo" && { color }]}>Yahoo Teams</Text>
              </TouchableOpacity>
            </View>
            <Divider />

            {tab === "saved" && (
              <>
                {savedLoading && <ActivityIndicator style={{ margin: 20 }} />}
                {!savedLoading && (!savedData || savedData.length === 0) && (
                  <Text style={styles.modalEmpty}>No saved rosters yet. Create one in the Roster tab.</Text>
                )}
                <ScrollView style={styles.modalList}>
                  {savedData?.map((roster) => (
                    <TouchableOpacity
                      key={roster.id}
                      style={styles.modalRow}
                      onPress={() => onLoadSaved(roster)}
                      activeOpacity={0.6}
                    >
                      <View style={styles.modalRowInfo}>
                        <Text style={styles.modalRosterName}>{roster.name}</Text>
                        <Text style={styles.modalRosterMeta}>
                          {roster.players.length} players · {roster.players.map((p) => p.name.split(" ").pop()).join(", ")}
                        </Text>
                      </View>
                      <IconButton icon="chevron-right" size={18} iconColor={color} style={{ margin: 0 }} />
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </>
            )}

            {tab === "yahoo" && (
              <>
                {yahooLoading && <ActivityIndicator style={{ margin: 20 }} />}
                {!yahooLoading && (!yahooData || yahooData.length === 0) && (
                  <Text style={styles.modalEmpty}>No Yahoo teams found. Sync Yahoo on the Dashboard first.</Text>
                )}
                <ScrollView style={styles.modalList}>
                  {yahooData?.map((team) => (
                    <TouchableOpacity
                      key={team.team_key}
                      style={styles.modalRow}
                      onPress={() => onLoadYahoo(team)}
                      activeOpacity={0.6}
                    >
                      <View style={styles.modalRowInfo}>
                        <Text style={styles.modalRosterName}>{team.team_name}</Text>
                        <Text style={styles.modalRosterMeta}>
                          {team.manager_name ? `${team.manager_name} · ` : ""}{team.roster.length} players
                        </Text>
                      </View>
                      <IconButton icon="chevron-right" size={18} iconColor={color} style={{ margin: 0 }} />
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </>
            )}
          </Surface>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Player picker (search from roster + NBA)
// ---------------------------------------------------------------------------
function PlayerPicker({
  color, excludeNames, onSelect,
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

  const rosterMatches = useMemo(() => {
    if (!roster) return [];
    const q = query.toLowerCase();
    return roster.filter((p) => !excludeNames.has(p.name) && p.name.toLowerCase().includes(q));
  }, [roster, query, excludeNames]);

  const rosterNames = new Set(roster?.map((p) => p.name) ?? []);
  const externalResults: NBAPlayerSearchResult[] = (searchResults ?? []).filter(
    (r) => !rosterNames.has(r.name) && !excludeNames.has(r.name)
  );

  const handlePickExternal = useCallback(async (result: NBAPlayerSearchResult) => {
    setLoadingId(result.player_id);
    try {
      const info = await getPlayerInfo(result.player_id);
      onSelect({ name: info.name, team: info.team, positions: info.positions });
      setLoadingId(null);
    } catch {
      setLoadingId(null);
    }
  }, [onSelect]);

  return (
    <View style={styles.pickerPanel}>
      <Searchbar
        placeholder="Search…"
        value={query}
        onChangeText={setQuery}
        style={styles.pickerSearch}
        loading={searching}
        elevation={0}
      />
      {rosterMatches.slice(0, 5).map((p) => (
        <TouchableOpacity
          key={p.name}
          style={styles.pickerRow}
          onPress={() => onSelect({ name: p.name, team: p.team, positions: p.positions })}
          activeOpacity={0.6}
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.pickerName}>{p.name}</Text>
            <Text style={styles.pickerMeta}>{p.team} · roster</Text>
          </View>
          <IconButton icon="plus" size={14} iconColor={color} style={styles.pickerPlusBtn} />
        </TouchableOpacity>
      ))}
      {query.length >= 2 && externalResults.slice(0, 3).map((r) => (
        <TouchableOpacity key={r.player_id} style={styles.pickerRow} onPress={() => handlePickExternal(r)} activeOpacity={0.6}>
          <View style={{ flex: 1 }}>
            <Text style={styles.pickerName}>{r.name}</Text>
            <Text style={styles.pickerMeta}>NBA search</Text>
          </View>
          {loadingId === r.player_id
            ? <ActivityIndicator size={14} style={styles.pickerPlusBtn} />
            : <IconButton icon="plus" size={14} iconColor={color} style={styles.pickerPlusBtn} />
          }
        </TouchableOpacity>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 40, gap: 12 },
  center: { flex: 1, justifyContent: "center", alignItems: "center", gap: 12 },
  hint: { color: "#aaa", textAlign: "center", fontSize: 13, marginTop: 8 },

  // Comparison bar
  comparisonBar: { borderRadius: 14, backgroundColor: "#fff", overflow: "hidden" },
  simLoading: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 16, paddingTop: 10 },
  simLoadingText: { fontSize: 11, color: "#888" },
  simNote: { fontSize: 10, color: "#aaa", textAlign: "center", paddingBottom: 10 },
  compRow: { flexDirection: "row", alignItems: "center", paddingVertical: 10, paddingHorizontal: 16 },
  compRowTotal: { backgroundColor: "#fafafa" },
  compValue: { fontSize: 18, fontWeight: "800", minWidth: 52, textAlign: "center" },
  compValueWinner: { fontSize: 26, minWidth: 58 },
  compMid: { flex: 1, alignItems: "center" },
  compLabel: { fontSize: 13, color: "#666" },
  compLabelTotal: { fontWeight: "700", color: "#1a1a1a" },
  diffText: { fontSize: 11, fontWeight: "700", marginTop: 1 },
  barDivider: { height: StyleSheet.hairlineWidth, backgroundColor: "#e8e8e8", marginHorizontal: 16 },

  // Panels
  rostersRow: { flexDirection: "row", gap: 10 },
  panel: { flex: 1, borderRadius: 14, backgroundColor: "#fff", overflow: "hidden" },
  panelHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingLeft: 12, paddingVertical: 2 },
  panelTitle: { fontSize: 15, fontWeight: "800" },
  panelHeaderActions: { flexDirection: "row" },
  panelActionBtn: { margin: 0, width: 32, height: 32 },
  emptyPanel: { color: "#bbb", textAlign: "center", paddingHorizontal: 8, paddingVertical: 16, fontSize: 11 },

  playerRow: { flexDirection: "row", alignItems: "center", paddingLeft: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#f0f0f0" },
  playerInfo: { flex: 1, paddingVertical: 8 },
  playerName: { fontSize: 12, fontWeight: "600", color: "#1a1a1a" },
  playerMeta: { fontSize: 10, color: "#888", marginTop: 1 },
  removeBtn: { margin: 0, width: 28, height: 28 },

  panelTotals: { flexDirection: "row", paddingVertical: 10 },
  panelTotalCell: { flex: 1, alignItems: "center" },
  panelTotalVal: { fontSize: 16, fontWeight: "800" },
  panelTotalLbl: { fontSize: 9, color: "#888", textTransform: "uppercase", letterSpacing: 0.3 },

  // Picker
  pickerPanel: { paddingHorizontal: 10, paddingBottom: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#f0f0f0" },
  pickerSearch: { marginBottom: 4, backgroundColor: "#f5f5f5", height: 38, borderRadius: 10 },
  pickerRow: { flexDirection: "row", alignItems: "center", paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#f8f8f8" },
  pickerName: { fontSize: 12, fontWeight: "600", color: "#1a1a1a" },
  pickerMeta: { fontSize: 10, color: "#888" },
  pickerPlusBtn: { margin: 0, width: 24, height: 24 },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", alignItems: "center", padding: 24 },
  modalCard: { width: 340, maxHeight: 500, borderRadius: 16, backgroundColor: "#fff", overflow: "hidden" },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  modalTitle: { fontSize: 16, fontWeight: "700" },
  modalTabs: { flexDirection: "row" },
  modalTab: { flex: 1, alignItems: "center", paddingVertical: 10 },
  modalTabText: { fontSize: 13, fontWeight: "600", color: "#888" },
  modalEmpty: { color: "#aaa", textAlign: "center", padding: 24, fontSize: 13 },
  modalList: { maxHeight: 360 },
  modalRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#f0f0f0" },
  modalRowInfo: { flex: 1 },
  modalRosterName: { fontSize: 14, fontWeight: "600", color: "#1a1a1a" },
  modalRosterMeta: { fontSize: 11, color: "#888", marginTop: 2 },
});
