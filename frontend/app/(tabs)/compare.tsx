/**
 * Compare two rosters side-by-side by playable starts per week.
 * Uses the /simulate-schedule endpoint to account for position constraints.
 */
import React, { useState, useMemo, useCallback } from "react";
import { Modal, ScrollView, StyleSheet, TouchableOpacity, View } from "react-native";
import {
  ActivityIndicator,
  Button,
  Chip,
  Divider,
  IconButton,
  Searchbar,
  SegmentedButtons,
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
const ROSTER_CAP = 13;

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
  const [activePanel, setActivePanel] = useState<"A" | "B">("A");

  // IL sets: player names excluded from each side's simulation
  const [ilA, setIlA] = useState<Set<string>>(new Set());
  const [ilB, setIlB] = useState<Set<string>>(new Set());

  // Active (non-IL) rosters, capped at 13
  const activeA = useMemo(
    () => rosterA.filter((p) => !ilA.has(p.name)).slice(0, ROSTER_CAP),
    [rosterA, ilA]
  );
  const activeB = useMemo(
    () => rosterB.filter((p) => !ilB.has(p.name)).slice(0, ROSTER_CAP),
    [rosterB, ilB]
  );

  // Stable keys so the query only re-runs when active roster changes
  const keyA = activeA.map((p) => p.name).sort().join(",");
  const keyB = activeB.map((p) => p.name).sort().join(",");

  const { data: simA, isFetching: loadingA } = useQuery({
    queryKey: ["simulate", keyA],
    queryFn: () => simulateSchedule(activeA),
    enabled: activeA.length > 0,
    staleTime: 60_000,
  });

  const { data: simB, isFetching: loadingB } = useQuery({
    queryKey: ["simulate", keyB],
    queryFn: () => simulateSchedule(activeB),
    enabled: activeB.length > 0,
    staleTime: 60_000,
  });

  // Build {playerName: {weekNum: starts}} lookups from simulation results
  const startsMapA = useMemo(() => buildStartsMap(simA), [simA]);
  const startsMapB = useMemo(() => buildStartsMap(simB), [simB]);

  const weekTotalA = (w: number) =>
    activeA.reduce((s, p) => s + (startsMapA[p.name]?.[w] ?? 0), 0);
  const weekTotalB = (w: number) =>
    activeB.reduce((s, p) => s + (startsMapB[p.name]?.[w] ?? 0), 0);
  const grandA = WEEKS.reduce((s, w) => s + weekTotalA(w), 0);
  const grandB = WEEKS.reduce((s, w) => s + weekTotalB(w), 0);

  const removeA = (name: string) => {
    setRosterA((r) => r.filter((p) => p.name !== name));
    setIlA((il) => { const n = new Set(il); n.delete(name); return n; });
  };
  const removeB = (name: string) => {
    setRosterB((r) => r.filter((p) => p.name !== name));
    setIlB((il) => { const n = new Set(il); n.delete(name); return n; });
  };

  const addToA = (p: ComparePlayer) => {
    if (!rosterA.find((x) => x.name === p.name)) setRosterA((r) => [...r, p]);
  };
  const addToB = (p: ComparePlayer) => {
    if (!rosterB.find((x) => x.name === p.name)) setRosterB((r) => [...r, p]);
  };

  const loadSavedToA = (roster: SavedRosterSchema) => {
    setRosterA(roster.players.map((p) => ({ name: p.name, team: p.team, positions: p.positions ?? [] })));
    setIlA(new Set());
  };
  const loadSavedToB = (roster: SavedRosterSchema) => {
    setRosterB(roster.players.map((p) => ({ name: p.name, team: p.team, positions: p.positions ?? [] })));
    setIlB(new Set());
  };

  const loadYahooToA = (team: LeagueTeamResponse) => {
    setRosterA(team.roster.map((p) => ({ name: p.name, team: p.team, positions: p.positions ?? [] })));
    setIlA(new Set());
  };
  const loadYahooToB = (team: LeagueTeamResponse) => {
    setRosterB(team.roster.map((p) => ({ name: p.name, team: p.team, positions: p.positions ?? [] })));
    setIlB(new Set());
  };

  const toggleIlA = useCallback((name: string) => {
    setIlA((prev) => { const n = new Set(prev); n.has(name) ? n.delete(name) : n.add(name); return n; });
  }, []);
  const toggleIlB = useCallback((name: string) => {
    setIlB((prev) => { const n = new Set(prev); n.has(name) ? n.delete(name) : n.add(name); return n; });
  }, []);

  const totA = WEEKS.map((w) => weekTotalA(w));
  const totB = WEEKS.map((w) => weekTotalB(w));

  const labelA = `Roster A${rosterA.length > 0 ? ` (${rosterA.length})` : ""}`;
  const labelB = `Roster B${rosterB.length > 0 ? ` (${rosterB.length})` : ""}`;

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
          {/* Column headers */}
          <View style={[styles.compRow, styles.compHeaderRow]}>
            <Text style={[styles.compHeaderVal, { color: "#6750a4" }]}>A</Text>
            <View style={styles.compMid} />
            <Text style={[styles.compHeaderVal, { color: "#c2185b" }]}>B</Text>
          </View>
          {WEEKS.map((w, i) => (
            <ComparisonRow
              key={w}
              label={`Wk ${w}`}
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
          <Text style={styles.simNote}>Playable starts · position-constrained · max {ROSTER_CAP} active</Text>
        </Surface>
      )}

      {/* A / B panel switcher */}
      <View style={styles.panelTabRow}>
        <SegmentedButtons
          value={activePanel}
          onValueChange={(v) => setActivePanel(v as "A" | "B")}
          buttons={[
            { value: "A", label: labelA, style: activePanel === "A" ? styles.panelTabActiveA : undefined },
            { value: "B", label: labelB, style: activePanel === "B" ? styles.panelTabActiveB : undefined },
          ]}
        />
      </View>

      {/* Active panel — full width */}
      {activePanel === "A" && (
        <RosterPanel
          side="A"
          color="#6750a4"
          players={rosterA}
          il={ilA}
          onToggleIl={toggleIlA}
          onRemove={removeA}
          onAdd={addToA}
          onLoadSaved={loadSavedToA}
          onLoadYahoo={loadYahooToA}
          startsMap={startsMapA}
          isLoading={loadingA}
        />
      )}
      {activePanel === "B" && (
        <RosterPanel
          side="B"
          color="#c2185b"
          players={rosterB}
          il={ilB}
          onToggleIl={toggleIlB}
          onRemove={removeB}
          onAdd={addToB}
          onLoadSaved={loadSavedToB}
          onLoadYahoo={loadYahooToB}
          startsMap={startsMapB}
          isLoading={loadingB}
        />
      )}

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
  side, color, players, il, onToggleIl, onRemove, onAdd, onLoadSaved, onLoadYahoo, startsMap, isLoading,
}: {
  side: "A" | "B";
  color: string;
  players: ComparePlayer[];
  il: Set<string>;
  onToggleIl: (name: string) => void;
  onRemove: (name: string) => void;
  onAdd: (p: ComparePlayer) => void;
  onLoadSaved: (roster: SavedRosterSchema) => void;
  onLoadYahoo: (team: LeagueTeamResponse) => void;
  startsMap: Record<string, Record<number, number>>;
  isLoading: boolean;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [showLoadModal, setShowLoadModal] = useState(false);
  const [showIlModal, setShowIlModal] = useState(false);

  const activeCount = players.filter((p) => !il.has(p.name)).length;
  const cappedCount = Math.min(activeCount, ROSTER_CAP);
  const overCap = activeCount > ROSTER_CAP;

  return (
    <Surface style={[styles.panel, { borderTopColor: color, borderTopWidth: 3 }]} elevation={1}>
      {/* Panel header */}
      <View style={[styles.panelHeader, { backgroundColor: color + "12" }]}>
        <View style={styles.panelTitleGroup}>
          <Text style={[styles.panelTitle, { color }]}>Roster {side}</Text>
          {players.length > 0 && (
            <Text style={[styles.rosterCountText, overCap && styles.rosterCountWarn]}>
              {cappedCount} active{il.size > 0 ? ` · ${il.size} IL` : ""}{overCap ? ` (max ${ROSTER_CAP})` : ""}
            </Text>
          )}
        </View>
        <View style={styles.panelHeaderActions}>
          {players.length > 0 && (
            <IconButton
              icon="clipboard-account-outline"
              size={20}
              iconColor={il.size > 0 ? "#c62828" : color}
              style={styles.panelActionBtn}
              onPress={() => { setShowIlModal(true); setShowAdd(false); setShowLoadModal(false); }}
            />
          )}
          <IconButton
            icon="bookmark-outline"
            size={20}
            iconColor={color}
            style={styles.panelActionBtn}
            onPress={() => { setShowLoadModal(true); setShowAdd(false); setShowIlModal(false); }}
          />
          <IconButton
            icon={showAdd ? "minus-circle-outline" : "plus-circle-outline"}
            iconColor={color}
            size={20}
            style={styles.panelActionBtn}
            onPress={() => { setShowAdd((v) => !v); setShowLoadModal(false); setShowIlModal(false); }}
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

      {/* IL editor modal */}
      <IlModal
        visible={showIlModal}
        color={color}
        players={players}
        il={il}
        onToggleIl={onToggleIl}
        onClose={() => setShowIlModal(false)}
      />

      {/* Empty state */}
      {players.length === 0 && !showAdd && (
        <Text style={styles.emptyPanel}>Tap + to add players or the bookmark icon to load a saved roster</Text>
      )}

      {/* Player list */}
      {players.map((p, idx) => {
        const isIl = il.has(p.name);
        const isCappedOut = !isIl && players.filter((x) => !il.has(x.name)).indexOf(p) >= ROSTER_CAP;
        const weekStarts = isIl || isCappedOut
          ? WEEKS.map(() => "–")
          : WEEKS.map((w) => startsMap[p.name]?.[w] ?? (isLoading ? "…" : 0));
        const totalStarts = isIl || isCappedOut
          ? "–"
          : isLoading
            ? "…"
            : WEEKS.reduce((s, w) => s + (startsMap[p.name]?.[w] ?? 0), 0);
        return (
          <View key={p.name} style={[styles.playerRow, (isIl || isCappedOut) && styles.playerRowDimmed]}>
            <View style={styles.playerInfo}>
              <View style={styles.playerNameRow}>
                <Text style={[styles.playerName, (isIl || isCappedOut) && styles.playerNameDimmed]} numberOfLines={1}>
                  {p.name}
                </Text>
                {isIl && (
                  <View style={styles.ilBadge}>
                    <Text style={styles.ilBadgeText}>IL</Text>
                  </View>
                )}
                {isCappedOut && !isIl && (
                  <View style={styles.capBadge}>
                    <Text style={styles.capBadgeText}>+{idx}</Text>
                  </View>
                )}
              </View>
              <Text style={styles.playerMeta}>
                {p.team} · {weekStarts.join("-")} ({totalStarts}S)
              </Text>
            </View>
            <IconButton icon="close" size={18} iconColor="#bbb" onPress={() => onRemove(p.name)} style={styles.removeBtn} />
          </View>
        );
      })}

      {/* Per-week subtotals */}
      {players.length > 0 && (
        <View style={[styles.panelTotals, { backgroundColor: color + "10" }]}>
          {WEEKS.map((w) => {
            const t = players
              .filter((p) => !il.has(p.name))
              .slice(0, ROSTER_CAP)
              .reduce((s, p) => s + (startsMap[p.name]?.[w] ?? 0), 0);
            return (
              <View key={w} style={styles.panelTotalCell}>
                <Text style={[styles.panelTotalVal, { color }]}>{isLoading ? "…" : t}</Text>
                <Text style={styles.panelTotalLbl}>Wk {w}</Text>
              </View>
            );
          })}
          <View style={styles.panelTotalCell}>
            <Text style={[styles.panelTotalVal, { color }]}>
              {isLoading ? "…" : players
                .filter((p) => !il.has(p.name))
                .slice(0, ROSTER_CAP)
                .reduce((s, p) => s + WEEKS.reduce((ss, w) => ss + (startsMap[p.name]?.[w] ?? 0), 0), 0)}
            </Text>
            <Text style={styles.panelTotalLbl}>Total</Text>
          </View>
        </View>
      )}
    </Surface>
  );
}

// ---------------------------------------------------------------------------
// IL editor modal
// ---------------------------------------------------------------------------
function IlModal({
  visible, color, players, il, onToggleIl, onClose,
}: {
  visible: boolean;
  color: string;
  players: ComparePlayer[];
  il: Set<string>;
  onToggleIl: (name: string) => void;
  onClose: () => void;
}) {
  const activeCount = players.filter((p) => !il.has(p.name)).length;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.ilModalOverlay}>
        <View style={styles.ilModalBox}>
          <View style={styles.ilModalHeader}>
            <Text style={styles.ilModalTitle}>Set Lineup</Text>
            <IconButton icon="close" size={20} onPress={onClose} style={styles.ilModalClose} />
          </View>
          <Text style={styles.ilModalSub}>
            Toggle players to IL to exclude them. Top {ROSTER_CAP} active players are used.
          </Text>
          <Divider style={styles.ilModalDivider} />
          <ScrollView style={styles.ilModalScroll}>
            {players.map((player) => {
              const isIl = il.has(player.name);
              return (
                <View key={player.name} style={styles.ilPlayerRow}>
                  <View style={styles.ilPlayerInfo}>
                    <Text style={styles.ilPlayerName}>{player.name}</Text>
                    <Text style={styles.ilPlayerMeta}>{player.team} · {player.positions.join("/")}</Text>
                  </View>
                  <Chip
                    selected={isIl}
                    onPress={() => onToggleIl(player.name)}
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
          <View style={styles.ilModalFooter}>
            <Text style={styles.ilModalCount}>
              {Math.min(activeCount, ROSTER_CAP)} active
              {activeCount > ROSTER_CAP ? ` (capped at ${ROSTER_CAP})` : ""}
              {il.size > 0 ? ` · ${il.size} IL` : ""}
            </Text>
            <Button mode="contained" onPress={onClose} style={[styles.ilModalDone, { backgroundColor: color }]}>
              Done
            </Button>
          </View>
        </View>
      </View>
    </Modal>
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
        placeholder="Search players…"
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
          <IconButton icon="plus" size={16} iconColor={color} style={styles.pickerPlusBtn} />
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
            : <IconButton icon="plus" size={16} iconColor={color} style={styles.pickerPlusBtn} />
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
  hint: { color: "#aaa", textAlign: "center", fontSize: 13, marginTop: 8 },

  // Comparison bar
  comparisonBar: { borderRadius: 14, backgroundColor: "#fff", overflow: "hidden" },
  simLoading: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 16, paddingTop: 10 },
  simLoadingText: { fontSize: 11, color: "#888" },
  simNote: { fontSize: 10, color: "#aaa", textAlign: "center", paddingBottom: 10, paddingHorizontal: 12 },
  compHeaderRow: { paddingBottom: 0, paddingTop: 10 },
  compHeaderVal: { fontSize: 13, fontWeight: "800", minWidth: 52, textAlign: "center" },
  compRow: { flexDirection: "row", alignItems: "center", paddingVertical: 10, paddingHorizontal: 16 },
  compRowTotal: { backgroundColor: "#fafafa" },
  compValue: { fontSize: 20, fontWeight: "800", minWidth: 52, textAlign: "center" },
  compValueWinner: { fontSize: 28, minWidth: 58 },
  compMid: { flex: 1, alignItems: "center" },
  compLabel: { fontSize: 13, color: "#666" },
  compLabelTotal: { fontWeight: "700", color: "#1a1a1a" },
  diffText: { fontSize: 11, fontWeight: "700", marginTop: 1 },
  barDivider: { height: StyleSheet.hairlineWidth, backgroundColor: "#e8e8e8", marginHorizontal: 16 },

  // Panel tab switcher
  panelTabRow: { marginBottom: 4 },
  panelTabActiveA: { borderBottomColor: "#6750a4", borderBottomWidth: 2 },
  panelTabActiveB: { borderBottomColor: "#c2185b", borderBottomWidth: 2 },

  // Panel (full width)
  panel: { borderRadius: 14, backgroundColor: "#fff", overflow: "hidden" },
  panelHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingLeft: 14, paddingRight: 4, paddingVertical: 6 },
  panelTitleGroup: { flex: 1, gap: 2 },
  panelTitle: { fontSize: 16, fontWeight: "800" },
  panelHeaderActions: { flexDirection: "row" },
  panelActionBtn: { margin: 0, width: 36, height: 36 },
  emptyPanel: { color: "#bbb", textAlign: "center", paddingHorizontal: 16, paddingVertical: 20, fontSize: 12 },

  rosterCountText: { fontSize: 11, color: "#888" },
  rosterCountWarn: { color: "#e65100", fontWeight: "700" },

  playerRow: { flexDirection: "row", alignItems: "center", paddingLeft: 14, paddingRight: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#f0f0f0" },
  playerRowDimmed: { opacity: 0.45 },
  playerInfo: { flex: 1, paddingVertical: 10 },
  playerNameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  playerName: { fontSize: 14, fontWeight: "600", color: "#1a1a1a" },
  playerNameDimmed: { color: "#999" },
  playerMeta: { fontSize: 12, color: "#888", marginTop: 2 },
  removeBtn: { margin: 0, width: 32, height: 32 },

  ilBadge: { backgroundColor: "#ffebee", borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2 },
  ilBadgeText: { fontSize: 10, fontWeight: "700", color: "#c62828", letterSpacing: 0.3 },
  capBadge: { backgroundColor: "#fff3e0", borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2 },
  capBadgeText: { fontSize: 10, fontWeight: "700", color: "#e65100" },

  panelTotals: { flexDirection: "row", paddingVertical: 12 },
  panelTotalCell: { flex: 1, alignItems: "center" },
  panelTotalVal: { fontSize: 18, fontWeight: "800" },
  panelTotalLbl: { fontSize: 10, color: "#888", textTransform: "uppercase", letterSpacing: 0.3, marginTop: 2 },

  // Picker
  pickerPanel: { paddingHorizontal: 14, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#f0f0f0" },
  pickerSearch: { marginBottom: 6, backgroundColor: "#f5f5f5", height: 40, borderRadius: 10 },
  pickerRow: { flexDirection: "row", alignItems: "center", paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#f8f8f8" },
  pickerName: { fontSize: 13, fontWeight: "600", color: "#1a1a1a" },
  pickerMeta: { fontSize: 11, color: "#888", marginTop: 1 },
  pickerPlusBtn: { margin: 0, width: 28, height: 28 },

  // Load roster modal
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", alignItems: "center", padding: 20 },
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

  // IL modal
  ilModalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  ilModalBox: {
    backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingTop: 4, paddingBottom: 32, maxHeight: "80%",
  },
  ilModalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingLeft: 20, paddingRight: 8, paddingTop: 12 },
  ilModalTitle: { fontSize: 15, fontWeight: "700", color: "#1a1a1a", flex: 1 },
  ilModalClose: { margin: 0 },
  ilModalSub: { fontSize: 12, color: "#888", paddingHorizontal: 20, marginBottom: 8 },
  ilModalDivider: { marginBottom: 4 },
  ilModalScroll: { flexGrow: 0 },
  ilPlayerRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#f0f0f0",
  },
  ilPlayerInfo: { flex: 1, marginRight: 12 },
  ilPlayerName: { fontSize: 13, fontWeight: "600", color: "#1a1a1a" },
  ilPlayerMeta: { fontSize: 11, color: "#888", marginTop: 1 },
  ilChip: { height: 28 },
  ilChipActive: { backgroundColor: "#ffebee" },
  ilChipText: { fontSize: 11, color: "#888" },
  ilChipTextActive: { color: "#c62828", fontWeight: "700" },
  ilModalFooter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingTop: 14 },
  ilModalCount: { fontSize: 13, color: "#555", fontWeight: "600" },
  ilModalDone: { borderRadius: 10 },
});
