import React, { useState, useCallback } from "react";
import { ScrollView, StyleSheet, TouchableOpacity, View } from "react-native";
import {
  ActivityIndicator,
  Button,
  Chip,
  Divider,
  IconButton,
  Searchbar,
  Surface,
  Text,
  useTheme,
} from "react-native-paper";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getRoster,
  searchPlayers,
  getPlayerInfo,
  addToRoster,
  removeFromRoster,
  updateRosterPositions,
  RosterPlayer,
  NBAPlayerSearchResult,
  NBAPlayerInfo,
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
      {/* Add Player — at the top */}
      <Surface style={styles.card} elevation={1}>
        <TouchableOpacity
          onPress={() => setSearchExpanded((v) => !v)}
          style={styles.addHeader}
          activeOpacity={0.7}
        >
          <Text style={[styles.sectionTitle, { color: theme.colors.onSurface }]}>
            Add Player
          </Text>
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

      {/* Current roster */}
      <CurrentRoster />
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Current roster
// ---------------------------------------------------------------------------
function CurrentRoster() {
  const theme = useTheme();
  const queryClient = useQueryClient();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["roster"],
    queryFn: getRoster,
  });

  const removeMutation = useMutation({
    mutationFn: removeFromRoster,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["roster"] });
      queryClient.invalidateQueries({ queryKey: ["player-grid"] });
      queryClient.invalidateQueries({ queryKey: ["calendar"] });
    },
  });

  if (isLoading || error) {
    return <LoadingOrError loading={isLoading} error={error as Error | null} onRetry={refetch} />;
  }

  const count = data?.length ?? 0;

  return (
    <Surface style={styles.card} elevation={1}>
      <View style={styles.rosterHeader}>
        <Text style={[styles.sectionTitle, { color: theme.colors.onSurface }]}>
          My Roster
        </Text>
        <Text style={[styles.countBadge, {
          color: count >= 13 ? "#c62828" : theme.colors.onSurfaceVariant,
        }]}>
          {count}/13
        </Text>
      </View>

      {count === 0 && (
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
  player,
  isLast,
  onRemove,
  removing,
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

  const togglePos = (pos: string) =>
    setPositions((prev) =>
      prev.includes(pos) ? prev.filter((p) => p !== pos) : [...prev, pos]
    );

  return (
    <View style={[styles.rosterRow, !isLast && styles.rosterRowBorder]}>
      {/* Main row */}
      <View style={styles.rosterRowMain}>
        {/* Name + meta */}
        <View style={styles.rosterPlayerInfo}>
          <Text style={styles.rosterPlayerName} numberOfLines={1}>
            {player.name}
          </Text>
          <View style={styles.rosterMeta}>
            <Text style={[styles.teamTag, { color: theme.colors.onSurfaceVariant }]}>
              {player.team}
            </Text>
            <Text style={styles.metaDot}>·</Text>
            {player.positions.map((pos) => (
              <Text key={pos} style={[styles.posTag, { color: theme.colors.primary }]}>
                {pos}
              </Text>
            ))}
          </View>
        </View>

        {/* Actions */}
        <View style={styles.rosterActions}>
          <IconButton
            icon="pencil-outline"
            size={18}
            iconColor={editing ? theme.colors.primary : theme.colors.onSurfaceVariant}
            onPress={() => {
              setPositions(player.positions);
              setEditing((v) => !v);
            }}
            style={styles.actionBtn}
          />
          {removing ? (
            <ActivityIndicator size={16} style={styles.actionBtn} />
          ) : (
            <IconButton
              icon="close-circle-outline"
              size={18}
              iconColor="#e65100"
              onPress={onRemove}
              style={styles.actionBtn}
            />
          )}
        </View>
      </View>

      {/* Inline position editor */}
      {editing && (
        <View style={styles.editPanel}>
          <Text style={[styles.editLabel, { color: theme.colors.onSurfaceVariant }]}>
            Tap to toggle positions:
          </Text>
          <View style={styles.posChipRow}>
            {POSITION_OPTIONS.map((pos) => (
              <Chip
                key={pos}
                selected={positions.includes(pos)}
                onPress={() => togglePos(pos)}
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
            <Button
              mode="text"
              compact
              onPress={() => setEditing(false)}
              textColor={theme.colors.onSurfaceVariant}
            >
              Cancel
            </Button>
            <Button
              mode="contained-tonal"
              compact
              onPress={() => saveMutation.mutate()}
              loading={saveMutation.isPending}
              disabled={saveMutation.isPending || positions.length === 0}
            >
              Save
            </Button>
          </View>
          {saveMutation.isError && (
            <Text style={styles.errorText}>
              {(saveMutation.error as Error).message}
            </Text>
          )}
        </View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Search + add flow
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
    setStep("search");
    setQuery("");
    setSelectedResult(null);
    setPlayerInfo(null);
    setCustomPositions([]);
    setInfoError(null);
  }, []);

  const handleSelectPlayer = useCallback(async (result: NBAPlayerSearchResult) => {
    setSelectedResult(result);
    setStep("confirm");
    setInfoLoading(true);
    setInfoError(null);
    try {
      const info = await getPlayerInfo(result.player_id);
      setPlayerInfo(info);
      setCustomPositions(info.positions);
    } catch (e: unknown) {
      setInfoError(e instanceof Error ? e.message : "Failed to load player info");
    } finally {
      setInfoLoading(false);
    }
  }, []);

  const togglePosition = useCallback((pos: string) => {
    setCustomPositions((prev) =>
      prev.includes(pos) ? prev.filter((p) => p !== pos) : [...prev, pos]
    );
  }, []);

  const handleAdd = useCallback(() => {
    if (!playerInfo || customPositions.length === 0) return;
    addMutation.mutate({
      player_id: playerInfo.player_id,
      name: playerInfo.name,
      team: playerInfo.team,
      positions: customPositions,
    });
  }, [playerInfo, customPositions, addMutation]);

  // ---- Confirm step ----
  if (step === "confirm") {
    return (
      <View style={styles.confirmPanel}>
        <View style={styles.confirmHeader}>
          <View>
            <Text style={[styles.confirmName, { color: theme.colors.onSurface }]}>
              {selectedResult?.name}
            </Text>
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
            <Text style={[styles.posLabel, { color: theme.colors.onSurfaceVariant }]}>
              Fantasy positions:
            </Text>
            <View style={styles.posChipRow}>
              {POSITION_OPTIONS.map((pos) => (
                <Chip
                  key={pos}
                  selected={customPositions.includes(pos)}
                  onPress={() => togglePosition(pos)}
                  showSelectedOverlay
                  style={styles.posChip}
                  textStyle={styles.posChipText}
                >
                  {pos}
                </Chip>
              ))}
            </View>

            {rosterCount >= 13 && (
              <Text style={styles.warningText}>Roster is full (13/13). Remove a player first.</Text>
            )}
            {rosterNames.has(playerInfo.name) && (
              <Text style={styles.warningText}>{playerInfo.name} is already on your roster.</Text>
            )}

            <Button
              mode="contained"
              onPress={handleAdd}
              loading={addMutation.isPending}
              disabled={
                addMutation.isPending ||
                customPositions.length === 0 ||
                rosterCount >= 13 ||
                rosterNames.has(playerInfo.name)
              }
              style={styles.addBtn}
            >
              Add to Roster
            </Button>

            {addMutation.isError && (
              <Text style={styles.errorText}>
                {(addMutation.error as Error).message}
              </Text>
            )}
          </>
        )}
      </View>
    );
  }

  // ---- Search step ----
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
            <Text style={[styles.resultName, onRoster && { color: "#aaa" }]}>
              {result.name}
            </Text>
            {onRoster ? (
              <Text style={styles.onRosterLabel}>On roster</Text>
            ) : (
              <IconButton icon="plus" size={16} iconColor={theme.colors.primary} style={styles.plusBtn} />
            )}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { padding: 16, gap: 12, paddingBottom: 40 },

  card: {
    borderRadius: 14,
    overflow: "hidden",
    backgroundColor: "#fff",
  },

  // Add player header
  addHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  chevron: { margin: 0 },

  // Section headings
  sectionTitle: { fontSize: 15, fontWeight: "700", letterSpacing: 0.1 },

  // Roster header
  rosterHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  countBadge: { fontSize: 13, fontWeight: "700" },
  emptyText: { color: "#aaa", textAlign: "center", paddingVertical: 20, fontSize: 13 },

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
  editPanel: {
    marginTop: 8,
    padding: 12,
    backgroundColor: "#f8f5ff",
    borderRadius: 10,
  },
  editLabel: { fontSize: 12, marginBottom: 8 },
  posChipRow: { flexDirection: "row", gap: 6, flexWrap: "wrap", marginBottom: 10 },
  posChip: { height: 30 },
  posChipText: { fontSize: 12 },
  editActions: { flexDirection: "row", justifyContent: "flex-end", gap: 8 },

  // Search panel
  searchPanel: { paddingHorizontal: 12, paddingBottom: 12 },
  searchBar: { marginBottom: 4, backgroundColor: "#f5f5f5", borderRadius: 10 },
  noResults: { color: "#aaa", textAlign: "center", padding: 12, fontSize: 13 },
  searchResult: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#ebebeb",
  },
  searchResultDim: { opacity: 0.45 },
  resultName: { flex: 1, fontSize: 14, fontWeight: "500", color: "#1a1a1a" },
  onRosterLabel: { fontSize: 12, color: "#6750a4", fontWeight: "500" },
  plusBtn: { margin: 0, width: 28, height: 28 },

  // Confirm panel
  confirmPanel: { padding: 16 },
  confirmHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 12 },
  confirmName: { fontSize: 17, fontWeight: "700" },
  confirmMeta: { fontSize: 13, marginTop: 2 },
  posLabel: { fontSize: 12, marginBottom: 8 },
  addBtn: { marginTop: 12 },
  spinner: { marginVertical: 12 },
  errorText: { color: "#c62828", fontSize: 12, marginTop: 6 },
  warningText: { color: "#e65100", fontSize: 12, fontWeight: "600", marginBottom: 6 },
});
