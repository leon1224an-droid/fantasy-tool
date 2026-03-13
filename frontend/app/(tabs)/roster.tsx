import React, { useState, useCallback, useMemo } from "react";
import { Alert, Platform, ScrollView, StyleSheet, TouchableOpacity, View } from "react-native";
import {
  ActivityIndicator,
  Button,
  Chip,
  Divider,
  IconButton,
  Searchbar,
  Surface,
  Text,
  TextInput,
  useTheme,
} from "react-native-paper";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getRoster,
  searchPlayers,
  getPlayerInfo,
  addToRoster,
  removeFromRoster,
  clearRoster,
  updateRosterPositions,
  getSavedRosters,
  createSavedRoster,
  updateSavedRoster,
  deleteSavedRoster,
  activateSavedRoster,
  loadYahooTeamToRoster,
  getLeagueTeams,
  RosterPlayer,
  NBAPlayerSearchResult,
  NBAPlayerInfo,
  SavedRosterSchema,
  SavedRosterEntry,
  LeagueTeamResponse,
} from "../../lib/api";
import { LoadingOrError } from "../../components/LoadingOrError";

const POSITION_OPTIONS = ["PG", "SG", "SF", "PF", "C"];

export default function RosterScreen() {
  const theme = useTheme();
  const [searchExpanded, setSearchExpanded] = useState(false);

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.colors.background }]}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.scrollContent}
    >
      {/* Add Player — collapsible at top */}
      <Surface style={styles.card} elevation={1}>
        <TouchableOpacity
          onPress={() => setSearchExpanded((v) => !v)}
          style={styles.cardHeader}
          activeOpacity={0.7}
        >
          <Text style={[styles.cardTitle, { color: theme.colors.onSurface }]}>Add Player</Text>
          <IconButton
            icon={searchExpanded ? "chevron-up" : "chevron-down"}
            size={20}
            iconColor={theme.colors.onSurfaceVariant}
            style={styles.chevron}
          />
        </TouchableOpacity>
        {searchExpanded && (
          <PlayerSearch onAdded={() => setSearchExpanded(false)} />
        )}
      </Surface>

      {/* Active roster */}
      <ActiveRoster />

      {/* Saved rosters */}
      <SavedRosters />
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Active roster
// ---------------------------------------------------------------------------
function ActiveRoster() {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [showLoadPicker, setShowLoadPicker] = useState(false);
  const [showYahooPicker, setShowYahooPicker] = useState(false);
  const [loadedRoster, setLoadedRoster] = useState<{ id: number; name: string } | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["roster"],
    queryFn: getRoster,
  });

  const { data: savedRosters } = useQuery({
    queryKey: ["saved-rosters"],
    queryFn: getSavedRosters,
  });

  const { data: yahooTeams } = useQuery({
    queryKey: ["league-teams"],
    queryFn: getLeagueTeams,
    enabled: showYahooPicker,
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["roster"] });
    queryClient.invalidateQueries({ queryKey: ["player-grid"] });
    queryClient.invalidateQueries({ queryKey: ["calendar"] });
  };

  const removeMutation = useMutation({
    mutationFn: removeFromRoster,
    onSuccess: invalidateAll,
  });

  const clearMutation = useMutation({
    mutationFn: clearRoster,
    onSuccess: () => { invalidateAll(); setLoadedRoster(null); },
  });

  const activateMutation = useMutation({
    mutationFn: (r: { id: number; name: string }) => activateSavedRoster(r.id),
    onSuccess: (_data, r) => { invalidateAll(); setShowLoadPicker(false); setLoadedRoster(r); },
  });

  const loadYahooMutation = useMutation({
    mutationFn: (team: LeagueTeamResponse) => loadYahooTeamToRoster(team.team_key),
    onSuccess: (_data, team) => {
      invalidateAll();
      setShowYahooPicker(false);
      setLoadedRoster(null); // Yahoo team isn't a saved roster
    },
  });

  const saveRosterMutation = useMutation({
    mutationFn: ({ name, players }: { name: string; players: SavedRosterEntry[] }) =>
      createSavedRoster(name, players),
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ["saved-rosters"] });
      setSaving(false);
      setSaveName("");
      setLoadedRoster({ id: saved.id, name: saved.name });
    },
  });

  const updateRosterMutation = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) =>
      updateSavedRoster(id, name, (data ?? []).map((p) => ({ name: p.name, team: p.team, positions: p.positions }))),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["saved-rosters"] }),
  });

  // Auto-detect which saved roster matches the current active players (works across refreshes)
  const detectedRoster = useMemo(() => {
    if (!data || !savedRosters) return null;
    const activeNames = new Set(data.map((p) => p.name));
    return savedRosters.find((s) => {
      const savedNames = new Set(s.players.map((p) => p.name));
      return activeNames.size === savedNames.size && [...activeNames].every((n) => savedNames.has(n));
    }) ?? null;
  }, [data, savedRosters]);

  // Effective roster for label + update button: detected match takes priority, fallback to session state
  const activeLoadedRoster = detectedRoster
    ? { id: detectedRoster.id, name: detectedRoster.name }
    : loadedRoster;

  if (isLoading || error) {
    return <LoadingOrError loading={isLoading} error={error as Error | null} onRetry={refetch} />;
  }

  const count = data?.length ?? 0;

  const handleSave = () => {
    if (!saveName.trim() || !data) return;
    saveRosterMutation.mutate({
      name: saveName.trim(),
      players: data.map((p) => ({ name: p.name, team: p.team, positions: p.positions })),
    });
  };

  const handleUpdate = () => {
    if (!activeLoadedRoster) return;
    const msg = `Update "${activeLoadedRoster.name}" with your current ${count} players?`;
    if (Platform.OS === "web") {
      if (window.confirm(msg)) updateRosterMutation.mutate(activeLoadedRoster);
    } else {
      Alert.alert("Update Roster", msg, [
        { text: "Cancel", style: "cancel" },
        { text: "Update", onPress: () => updateRosterMutation.mutate(activeLoadedRoster!) },
      ]);
    }
  };

  const handleClearAll = () => {
    const msg = "Remove all players from your active roster?";
    if (Platform.OS === "web") {
      if (window.confirm(msg)) clearMutation.mutate();
    } else {
      Alert.alert("Clear Roster", msg, [
        { text: "Cancel", style: "cancel" },
        { text: "Clear All", style: "destructive", onPress: () => clearMutation.mutate() },
      ]);
    }
  };

  return (
    <Surface style={styles.card} elevation={1}>
      <View style={styles.cardHeader}>
        <View style={styles.rosterTitleGroup}>
          <Text style={[styles.cardTitle, { color: theme.colors.onSurface }]}>My Roster</Text>
          {activeLoadedRoster && (
            <Text style={styles.loadedLabel} numberOfLines={1}>· {activeLoadedRoster.name}</Text>
          )}
        </View>
        <View style={styles.rosterHeaderRight}>
          <Text style={[styles.countBadge, { color: count >= 13 ? "#c62828" : theme.colors.onSurfaceVariant }]}>
            {count}/13
          </Text>
          {/* Load from Yahoo league */}
          <IconButton
            icon="account-group-outline"
            size={20}
            iconColor="#6a0dad"
            onPress={() => { setShowYahooPicker((v) => !v); setShowLoadPicker(false); setSaving(false); }}
            style={styles.actionBtn}
          />
          {/* Load saved roster */}
          <IconButton
            icon="folder-open-outline"
            size={20}
            iconColor={theme.colors.primary}
            onPress={() => { setShowLoadPicker((v) => !v); setShowYahooPicker(false); setSaving(false); }}
            style={styles.actionBtn}
          />
          {/* Save as new */}
          <IconButton
            icon="content-save-outline"
            size={20}
            iconColor={theme.colors.primary}
            onPress={() => { setSaving((v) => !v); setShowLoadPicker(false); }}
            style={styles.actionBtn}
          />
          {/* Update loaded roster */}
          {activeLoadedRoster && (
            <IconButton
              icon="content-save-edit-outline"
              size={20}
              iconColor="#2e7d32"
              onPress={handleUpdate}
              disabled={updateRosterMutation.isPending}
              style={styles.actionBtn}
            />
          )}
          {/* Clear all */}
          {count > 0 && (
            <IconButton
              icon="trash-can-outline"
              size={20}
              iconColor="#e65100"
              onPress={handleClearAll}
              disabled={clearMutation.isPending}
              style={styles.actionBtn}
            />
          )}
        </View>
      </View>

      {/* Load saved roster picker */}
      {showLoadPicker && (
        <View style={styles.loadPickerPanel}>
          {!savedRosters || savedRosters.length === 0 ? (
            <Text style={styles.emptyText}>No saved rosters yet.</Text>
          ) : (
            savedRosters.map((r) => (
              <TouchableOpacity
                key={r.id}
                style={styles.loadPickerRow}
                onPress={() => activateMutation.mutate(r)}
                activeOpacity={0.6}
              >
                <View style={styles.loadPickerInfo}>
                  <Text style={styles.loadPickerName}>{r.name}</Text>
                  <Text style={styles.loadPickerMeta}>{r.players.length} players</Text>
                </View>
                {activateMutation.isPending && activateMutation.variables?.id === r.id
                  ? <ActivityIndicator size={16} />
                  : <IconButton icon="swap-horizontal" size={18} iconColor="#1565c0" style={styles.actionBtn} />
                }
              </TouchableOpacity>
            ))
          )}
        </View>
      )}

      {/* Yahoo team picker */}
      {showYahooPicker && (
        <View style={styles.loadPickerPanel}>
          {!yahooTeams ? (
            <ActivityIndicator style={{ margin: 16 }} />
          ) : yahooTeams.length === 0 ? (
            <Text style={styles.emptyText}>No Yahoo teams found. Sync Yahoo on the Dashboard first.</Text>
          ) : (
            yahooTeams.map((team) => (
              <TouchableOpacity
                key={team.team_key}
                style={styles.loadPickerRow}
                onPress={() => loadYahooMutation.mutate(team)}
                activeOpacity={0.6}
              >
                <View style={styles.loadPickerInfo}>
                  <Text style={styles.loadPickerName}>{team.team_name}</Text>
                  <Text style={styles.loadPickerMeta}>
                    {team.manager_name ? `${team.manager_name} · ` : ""}{team.roster.length} players
                  </Text>
                </View>
                {loadYahooMutation.isPending && loadYahooMutation.variables?.team_key === team.team_key
                  ? <ActivityIndicator size={16} />
                  : <IconButton icon="swap-horizontal" size={18} iconColor="#6a0dad" style={styles.actionBtn} />
                }
              </TouchableOpacity>
            ))
          )}
        </View>
      )}

      {/* Save-as input */}
      {saving && (
        <View style={styles.saveRow}>
          <TextInput
            mode="outlined"
            placeholder="Roster name…"
            value={saveName}
            onChangeText={setSaveName}
            style={styles.saveInput}
            dense
          />
          <Button
            mode="contained-tonal"
            compact
            onPress={handleSave}
            loading={saveRosterMutation.isPending}
            disabled={!saveName.trim() || saveRosterMutation.isPending}
          >
            Save
          </Button>
          <Button mode="text" compact onPress={() => { setSaving(false); setSaveName(""); }}>
            Cancel
          </Button>
        </View>
      )}
      {saveRosterMutation.isError && (
        <Text style={styles.errorText}>{(saveRosterMutation.error as Error).message}</Text>
      )}

      {count === 0 && !showLoadPicker && (
        <Text style={styles.emptyText}>No players yet — add some above.</Text>
      )}

      {data?.map((player, idx) => (
        <RosterRow
          key={player.name}
          player={player}
          isLast={idx === data.length - 1}
          onRemove={() => removeMutation.mutate(player.name)}
          removing={removeMutation.isPending && removeMutation.variables === player.name}
        />
      ))}
    </Surface>
  );
}

// ---------------------------------------------------------------------------
// Single roster row with inline position editor
// ---------------------------------------------------------------------------
function RosterRow({
  player, isLast, onRemove, removing,
}: {
  player: RosterPlayer;
  isLast: boolean;
  onRemove: () => void;
  removing: boolean;
}) {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [positions, setPositions] = useState<string[]>(player.positions);

  const saveMutation = useMutation({
    mutationFn: () => updateRosterPositions(player.name, positions),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["roster"] });
      setEditing(false);
    },
  });

  return (
    <View style={[styles.rosterRow, !isLast && styles.rosterRowBorder]}>
      <View style={styles.rosterRowMain}>
        <View style={styles.rosterPlayerInfo}>
          <Text style={styles.rosterPlayerName} numberOfLines={1}>{player.name}</Text>
          <View style={styles.rosterMeta}>
            <Text style={[styles.teamTag, { color: theme.colors.onSurfaceVariant }]}>{player.team}</Text>
            <Text style={styles.metaDot}>·</Text>
            {player.positions.map((pos) => (
              <Text key={pos} style={[styles.posTag, { color: theme.colors.primary }]}>{pos}</Text>
            ))}
          </View>
        </View>
        <View style={styles.rosterActions}>
          <IconButton
            icon="pencil-outline"
            size={18}
            iconColor={editing ? theme.colors.primary : theme.colors.onSurfaceVariant}
            onPress={() => { setPositions(player.positions); setEditing((v) => !v); }}
            style={styles.actionBtn}
          />
          {removing ? (
            <ActivityIndicator size={16} style={styles.actionBtn} />
          ) : (
            <IconButton icon="close-circle-outline" size={18} iconColor="#e65100" onPress={onRemove} style={styles.actionBtn} />
          )}
        </View>
      </View>

      {editing && (
        <View style={styles.editPanel}>
          <Text style={[styles.editLabel, { color: theme.colors.onSurfaceVariant }]}>Tap to toggle positions:</Text>
          <View style={styles.posChipRow}>
            {POSITION_OPTIONS.map((pos) => (
              <Chip
                key={pos}
                selected={positions.includes(pos)}
                onPress={() => setPositions((p) => p.includes(pos) ? p.filter((x) => x !== pos) : [...p, pos])}
                compact
                showSelectedOverlay
                style={styles.posChip}
                textStyle={styles.posChipText}
              >
                {pos}
              </Chip>
            ))}
          </View>
          <View style={styles.editActions}>
            <Button mode="text" compact onPress={() => setEditing(false)} textColor={theme.colors.onSurfaceVariant}>Cancel</Button>
            <Button mode="contained-tonal" compact onPress={() => saveMutation.mutate()} loading={saveMutation.isPending} disabled={saveMutation.isPending || positions.length === 0}>Save</Button>
          </View>
          {saveMutation.isError && <Text style={styles.errorText}>{(saveMutation.error as Error).message}</Text>}
        </View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Saved rosters section
// ---------------------------------------------------------------------------
function SavedRosters() {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["saved-rosters"],
    queryFn: getSavedRosters,
  });

  const deleteMutation = useMutation({
    mutationFn: deleteSavedRoster,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["saved-rosters"] }),
  });

  const activateMutation = useMutation({
    mutationFn: activateSavedRoster,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["roster"] });
      queryClient.invalidateQueries({ queryKey: ["player-grid"] });
      queryClient.invalidateQueries({ queryKey: ["calendar"] });
    },
  });

  const renameMutation = useMutation({
    mutationFn: ({ id, name, players }: { id: number; name: string; players: SavedRosterEntry[] }) =>
      updateSavedRoster(id, name, players),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["saved-rosters"] });
      setEditingId(null);
    },
  });


  const confirmActivate = (roster: SavedRosterSchema) => {
    const msg = `Replace your current active roster with "${roster.name}"? This will deactivate your current players.`;
    if (Platform.OS === "web") {
      if (window.confirm(msg)) activateMutation.mutate(roster.id);
    } else {
      Alert.alert("Set as Active Roster", msg, [
        { text: "Cancel", style: "cancel" },
        { text: "Activate", style: "destructive", onPress: () => activateMutation.mutate(roster.id) },
      ]);
    }
  };

  const confirmDelete = (roster: SavedRosterSchema) => {
    const msg = `Delete "${roster.name}"?`;
    if (Platform.OS === "web") {
      if (window.confirm(msg)) deleteMutation.mutate(roster.id);
    } else {
      Alert.alert("Delete Roster", msg, [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => deleteMutation.mutate(roster.id) },
      ]);
    }
  };

  return (
    <Surface style={styles.card} elevation={1}>
      <TouchableOpacity onPress={() => setExpanded((v) => !v)} style={styles.cardHeader} activeOpacity={0.7}>
        <View style={styles.savedHeaderLeft}>
          <Text style={[styles.cardTitle, { color: theme.colors.onSurface }]}>Saved Rosters</Text>
          {data && data.length > 0 && (
            <View style={styles.savedCountPill}>
              <Text style={styles.savedCountText}>{data.length}</Text>
            </View>
          )}
        </View>
        <IconButton icon={expanded ? "chevron-up" : "chevron-down"} size={20} iconColor={theme.colors.onSurfaceVariant} style={styles.chevron} />
      </TouchableOpacity>

      {expanded && (
        <>
          {(isLoading || error) && (
            <LoadingOrError loading={isLoading} error={error as Error | null} onRetry={refetch} />
          )}
          {data?.length === 0 && (
            <Text style={styles.emptyText}>No saved rosters yet. Use the save icon on My Roster.</Text>
          )}

          {data?.map((roster, idx) => (
            <View key={roster.id} style={[styles.savedRow, idx < data.length - 1 && styles.rosterRowBorder]}>
              {editingId === roster.id ? (
                <View style={styles.renameRow}>
                  <TextInput
                    mode="outlined"
                    value={editName}
                    onChangeText={setEditName}
                    style={styles.saveInput}
                    dense
                    autoFocus
                  />
                  <Button
                    mode="contained-tonal"
                    compact
                    onPress={() => renameMutation.mutate({ id: roster.id, name: editName.trim(), players: roster.players })}
                    loading={renameMutation.isPending}
                    disabled={!editName.trim() || renameMutation.isPending}
                  >
                    OK
                  </Button>
                  <Button mode="text" compact onPress={() => setEditingId(null)}>✕</Button>
                </View>
              ) : (
                <View style={styles.savedRowMain}>
                  <View style={styles.savedInfo}>
                    <Text style={styles.savedName} numberOfLines={1}>{roster.name}</Text>
                    <Text style={styles.savedMeta}>{roster.players.length} players</Text>
                  </View>
                  <View style={styles.savedActions}>
                    {activateMutation.isPending && activateMutation.variables === roster.id ? (
                      <ActivityIndicator size={16} />
                    ) : (
                      <IconButton
                        icon="swap-horizontal"
                        size={18}
                        iconColor="#1565c0"
                        onPress={() => confirmActivate(roster)}
                        style={styles.actionBtn}
                      />
                    )}
                    <IconButton
                      icon="pencil-outline"
                      size={18}
                      iconColor={theme.colors.onSurfaceVariant}
                      onPress={() => { setEditingId(roster.id); setEditName(roster.name); }}
                      style={styles.actionBtn}
                    />
                    <IconButton
                      icon="delete-outline"
                      size={18}
                      iconColor="#e65100"
                      onPress={() => confirmDelete(roster)}
                      style={styles.actionBtn}
                    />
                  </View>
                </View>
              )}

              {/* Player preview */}
              {editingId !== roster.id && (
                <Text style={styles.savedPlayers} numberOfLines={2}>
                  {roster.players.map((p) => p.name).join(", ")}
                </Text>
              )}
            </View>
          ))}
        </>
      )}
    </Surface>
  );
}

// ---------------------------------------------------------------------------
// Search + add flow (unchanged from before)
// ---------------------------------------------------------------------------
type AddStep = "search" | "confirm";

function PlayerSearch({ onAdded }: { onAdded: () => void }) {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [step, setStep] = useState<AddStep>("search");
  const [selectedResult, setSelectedResult] = useState<NBAPlayerSearchResult | null>(null);
  const [playerInfo, setPlayerInfo] = useState<NBAPlayerInfo | null>(null);
  const [customPositions, setCustomPositions] = useState<string[]>([]);
  const [infoLoading, setInfoLoading] = useState(false);
  const [infoError, setInfoError] = useState<string | null>(null);

  const { data: searchResults, isFetching: searching } = useQuery({
    queryKey: ["players-search", query],
    queryFn: () => (query.length >= 2 ? searchPlayers(query) : Promise.resolve([])),
    enabled: query.length >= 2,
  });

  const { data: rosterData } = useQuery({ queryKey: ["roster"], queryFn: getRoster });
  const rosterNames = new Set(rosterData?.map((p) => p.name) ?? []);
  const rosterCount = rosterData?.length ?? 0;

  const addMutation = useMutation({
    mutationFn: addToRoster,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["roster"] });
      queryClient.invalidateQueries({ queryKey: ["player-grid"] });
      queryClient.invalidateQueries({ queryKey: ["calendar"] });
      resetFlow();
      onAdded();
    },
  });

  const resetFlow = useCallback(() => {
    setStep("search"); setQuery(""); setSelectedResult(null);
    setPlayerInfo(null); setCustomPositions([]); setInfoError(null);
  }, []);

  const handleSelectPlayer = useCallback(async (result: NBAPlayerSearchResult) => {
    setSelectedResult(result); setStep("confirm");
    setInfoLoading(true); setInfoError(null);
    try {
      const info = await getPlayerInfo(result.player_id);
      setPlayerInfo(info); setCustomPositions(info.positions);
    } catch (e: unknown) {
      setInfoError(e instanceof Error ? e.message : "Failed to load player info");
    } finally {
      setInfoLoading(false);
    }
  }, []);

  if (step === "confirm") {
    return (
      <View style={styles.confirmPanel}>
        <View style={styles.confirmHeader}>
          <View>
            <Text style={[styles.confirmName, { color: theme.colors.onSurface }]}>{selectedResult?.name}</Text>
            {playerInfo && (
              <Text style={[styles.confirmMeta, { color: theme.colors.onSurfaceVariant }]}>
                {playerInfo.team} · {playerInfo.nba_position}
              </Text>
            )}
          </View>
          <IconButton icon="arrow-left" size={20} onPress={resetFlow} />
        </View>
        {infoLoading && <ActivityIndicator style={styles.spinner} />}
        {infoError && <Text style={styles.errorText}>{infoError}</Text>}
        {playerInfo && (
          <>
            <Text style={[styles.posLabel, { color: theme.colors.onSurfaceVariant }]}>Fantasy positions:</Text>
            <View style={styles.posChipRow}>
              {POSITION_OPTIONS.map((pos) => (
                <Chip
                  key={pos}
                  selected={customPositions.includes(pos)}
                  onPress={() => setCustomPositions((p) => p.includes(pos) ? p.filter((x) => x !== pos) : [...p, pos])}
                  showSelectedOverlay
                  style={styles.posChip}
                  textStyle={styles.posChipText}
                >
                  {pos}
                </Chip>
              ))}
            </View>
            {rosterCount >= 13 && <Text style={styles.warningText}>Roster is full (13/13).</Text>}
            {rosterNames.has(playerInfo.name) && <Text style={styles.warningText}>{playerInfo.name} is already on your roster.</Text>}
            <Button
              mode="contained"
              onPress={() => addMutation.mutate({ player_id: playerInfo.player_id, name: playerInfo.name, team: playerInfo.team, positions: customPositions })}
              loading={addMutation.isPending}
              disabled={addMutation.isPending || customPositions.length === 0 || rosterCount >= 13 || rosterNames.has(playerInfo.name)}
              style={styles.addBtn}
            >
              Add to Roster
            </Button>
            {addMutation.isError && <Text style={styles.errorText}>{(addMutation.error as Error).message}</Text>}
          </>
        )}
      </View>
    );
  }

  return (
    <View style={styles.searchPanel}>
      <Searchbar
        placeholder="Search by name…"
        value={query}
        onChangeText={setQuery}
        style={styles.searchBar}
        loading={searching}
        elevation={0}
      />
      {query.length >= 2 && !searching && searchResults?.length === 0 && (
        <Text style={styles.noResults}>No active players found for "{query}"</Text>
      )}
      {searchResults?.slice(0, 8).map((result) => {
        const onRoster = rosterNames.has(result.name);
        return (
          <TouchableOpacity
            key={result.player_id}
            onPress={!onRoster ? () => handleSelectPlayer(result) : undefined}
            activeOpacity={onRoster ? 1 : 0.6}
            style={[styles.searchResult, onRoster && styles.searchResultDim]}
          >
            <Text style={[styles.resultName, onRoster && { color: "#aaa" }]}>{result.name}</Text>
            {onRoster
              ? <Text style={styles.onRosterLabel}>On roster</Text>
              : <IconButton icon="plus" size={16} iconColor={theme.colors.primary} style={styles.plusBtn} />
            }
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { padding: 16, gap: 12, paddingBottom: 40 },
  card: { borderRadius: 14, overflow: "hidden", backgroundColor: "#fff" },

  cardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12 },
  cardTitle: { fontSize: 15, fontWeight: "700", letterSpacing: 0.1 },
  chevron: { margin: 0 },

  // Active roster header
  rosterTitleGroup: { flexDirection: "row", alignItems: "center", gap: 6, flex: 1, minWidth: 0 },
  loadedLabel: { fontSize: 13, color: "#6750a4", fontWeight: "600", flexShrink: 1 },
  rosterHeaderRight: { flexDirection: "row", alignItems: "center" },
  countBadge: { fontSize: 13, fontWeight: "700" },

  // Load picker
  loadPickerPanel: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#ebebeb", paddingBottom: 4 },
  loadPickerRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#f5f5f5" },
  loadPickerInfo: { flex: 1 },
  loadPickerName: { fontSize: 13, fontWeight: "600", color: "#1a1a1a" },
  loadPickerMeta: { fontSize: 11, color: "#888" },

  // Save-as row
  saveRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingBottom: 12 },
  saveInput: { flex: 1, height: 38 },

  emptyText: { color: "#aaa", textAlign: "center", paddingVertical: 20, fontSize: 13 },
  errorText: { color: "#c62828", fontSize: 12, marginHorizontal: 16, marginBottom: 8 },

  // Roster rows
  rosterRow: { paddingHorizontal: 16, paddingVertical: 10 },
  rosterRowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#ebebeb" },
  rosterRowMain: { flexDirection: "row", alignItems: "center" },
  rosterPlayerInfo: { flex: 1 },
  rosterPlayerName: { fontSize: 14, fontWeight: "600", color: "#1a1a1a", marginBottom: 2 },
  rosterMeta: { flexDirection: "row", alignItems: "center", gap: 4 },
  teamTag: { fontSize: 12 },
  metaDot: { fontSize: 12, color: "#ccc" },
  posTag: { fontSize: 12, fontWeight: "600" },
  rosterActions: { flexDirection: "row", alignItems: "center" },
  actionBtn: { margin: 0, width: 32, height: 32 },

  // Edit panel
  editPanel: { marginTop: 8, padding: 12, backgroundColor: "#f8f5ff", borderRadius: 10 },
  editLabel: { fontSize: 12, marginBottom: 8 },
  posChipRow: { flexDirection: "row", gap: 6, flexWrap: "wrap", marginBottom: 10 },
  posChip: { height: 30 },
  posChipText: { fontSize: 12 },
  editActions: { flexDirection: "row", justifyContent: "flex-end", gap: 8 },

  // Saved rosters
  savedHeaderLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  savedCountPill: { backgroundColor: "#6750a4", borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2 },
  savedCountText: { color: "#fff", fontSize: 11, fontWeight: "700" },
  savedRow: { paddingHorizontal: 16, paddingVertical: 10 },
  savedRowMain: { flexDirection: "row", alignItems: "center" },
  savedInfo: { flex: 1 },
  savedName: { fontSize: 14, fontWeight: "600", color: "#1a1a1a" },
  savedMeta: { fontSize: 11, color: "#888", marginTop: 1 },
  savedActions: { flexDirection: "row", alignItems: "center" },
  savedPlayers: { fontSize: 11, color: "#aaa", marginTop: 4, lineHeight: 16 },
  renameRow: { flexDirection: "row", alignItems: "center", gap: 8 },

  // Search
  searchPanel: { paddingHorizontal: 12, paddingBottom: 12 },
  searchBar: { marginBottom: 4, backgroundColor: "#f5f5f5", borderRadius: 10 },
  noResults: { color: "#aaa", textAlign: "center", padding: 12, fontSize: 13 },
  searchResult: { flexDirection: "row", alignItems: "center", paddingVertical: 10, paddingHorizontal: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#ebebeb" },
  searchResultDim: { opacity: 0.45 },
  resultName: { flex: 1, fontSize: 14, fontWeight: "500", color: "#1a1a1a" },
  onRosterLabel: { fontSize: 12, color: "#6750a4", fontWeight: "500" },
  plusBtn: { margin: 0, width: 28, height: 28 },

  // Confirm
  confirmPanel: { padding: 16 },
  confirmHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 12 },
  confirmName: { fontSize: 17, fontWeight: "700" },
  confirmMeta: { fontSize: 13, marginTop: 2 },
  posLabel: { fontSize: 12, marginBottom: 8 },
  addBtn: { marginTop: 12 },
  spinner: { marginVertical: 12 },
  warningText: { color: "#e65100", fontSize: 12, fontWeight: "600", marginBottom: 6 },
});
