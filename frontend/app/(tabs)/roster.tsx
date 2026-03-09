import React, { useState, useCallback } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import {
  ActivityIndicator,
  Button,
  Chip,
  Divider,
  IconButton,
  List,
  Searchbar,
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
  RosterPlayer,
  NBAPlayerSearchResult,
  NBAPlayerInfo,
} from "../../lib/api";
import { LoadingOrError } from "../../components/LoadingOrError";

const POSITION_OPTIONS = ["PG", "SG", "SF", "PF", "C"];

export default function RosterScreen() {
  const theme = useTheme();

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.colors.background }]}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={[styles.title, { color: theme.colors.onBackground }]}>
        Roster Management
      </Text>
      <Text style={[styles.subtitle, { color: theme.colors.onSurfaceVariant }]}>
        Up to 13 players — add or remove active NBA players
      </Text>

      <CurrentRoster />

      <Divider style={styles.divider} />

      <Text style={[styles.sectionTitle, { color: theme.colors.onBackground }]}>
        Add Player
      </Text>
      <PlayerSearch />
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Current roster list
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["roster"] }),
  });

  if (isLoading || error) {
    return (
      <LoadingOrError loading={isLoading} error={error as Error | null} onRetry={refetch} />
    );
  }

  const count = data?.length ?? 0;

  return (
    <View style={styles.rosterSection}>
      <Text style={[styles.rosterCount, { color: theme.colors.onSurfaceVariant }]}>
        {count}/13 players
      </Text>

      {data && data.length === 0 && (
        <Text style={styles.emptyText}>
          No players on roster. Add players below.
        </Text>
      )}

      {data?.map((player) => (
        <RosterRow
          key={player.name}
          player={player}
          onRemove={() => removeMutation.mutate(player.name)}
          removing={removeMutation.isPending && removeMutation.variables === player.name}
        />
      ))}
    </View>
  );
}

function RosterRow({
  player,
  onRemove,
  removing,
}: {
  player: RosterPlayer;
  onRemove: () => void;
  removing: boolean;
}) {
  return (
    <List.Item
      title={player.name}
      description={`${player.team} · ${player.positions.join("/")}${!player.is_active ? " · Inactive" : ""}`}
      titleStyle={styles.playerName}
      descriptionStyle={styles.playerMeta}
      left={() => (
        <View style={styles.positionBadges}>
          {player.positions.slice(0, 2).map((p) => (
            <Chip key={p} compact style={styles.posBadge} textStyle={styles.posBadgeText}>
              {p}
            </Chip>
          ))}
        </View>
      )}
      right={() =>
        removing ? (
          <ActivityIndicator size="small" style={styles.rowSpinner} />
        ) : (
          <IconButton
            icon="close-circle"
            iconColor="#e65100"
            size={22}
            onPress={onRemove}
          />
        )
      }
      style={styles.rosterRow}
    />
  );
}

// ---------------------------------------------------------------------------
// Player search + add flow
// ---------------------------------------------------------------------------
type AddStep = "search" | "confirm";

function PlayerSearch() {
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

  // Confirm step
  if (step === "confirm") {
    return (
      <View style={styles.confirmPanel}>
        <Text style={[styles.confirmName, { color: theme.colors.onSurface }]}>
          {selectedResult?.name}
        </Text>

        {infoLoading && <ActivityIndicator style={styles.spinner} />}
        {infoError && <Text style={styles.errorText}>{infoError}</Text>}

        {playerInfo && (
          <>
            <Text style={[styles.confirmMeta, { color: theme.colors.onSurfaceVariant }]}>
              Team: {playerInfo.team} · NBA Position: {playerInfo.nba_position}
            </Text>

            <Text style={[styles.posLabel, { color: theme.colors.onSurface }]}>
              Fantasy positions (tap to toggle):
            </Text>
            <View style={styles.posRow}>
              {POSITION_OPTIONS.map((pos) => (
                <Chip
                  key={pos}
                  selected={customPositions.includes(pos)}
                  onPress={() => togglePosition(pos)}
                  style={styles.posChip}
                  showSelectedOverlay
                >
                  {pos}
                </Chip>
              ))}
            </View>

            {rosterCount >= 13 && (
              <Text style={styles.limitWarning}>
                Roster is full (13/13). Remove a player first.
              </Text>
            )}
            {rosterNames.has(playerInfo.name) && (
              <Text style={styles.limitWarning}>
                {playerInfo.name} is already on your roster.
              </Text>
            )}

            <View style={styles.confirmButtons}>
              <Button mode="outlined" onPress={resetFlow} style={styles.cancelBtn}>
                Cancel
              </Button>
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
            </View>

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

  // Search step
  return (
    <View style={styles.searchPanel}>
      <Searchbar
        placeholder="Search NBA player..."
        value={query}
        onChangeText={setQuery}
        style={styles.searchBar}
        loading={searching}
      />

      {query.length >= 2 && searchResults && searchResults.length === 0 && !searching && (
        <Text style={styles.noResults}>No players found for "{query}"</Text>
      )}

      {searchResults?.slice(0, 8).map((result) => {
        const onRoster = rosterNames.has(result.name);
        return (
          <List.Item
            key={result.player_id}
            title={result.name}
            description={onRoster ? "Already on roster" : result.is_active ? "Active" : "Inactive"}
            titleStyle={[styles.resultName, onRoster && styles.dimText]}
            descriptionStyle={[onRoster ? styles.onRosterText : styles.activeText]}
            onPress={!onRoster ? () => handleSelectPlayer(result) : undefined}
            right={() =>
              onRoster ? null : (
                <IconButton icon="plus-circle" iconColor="#6750a4" size={22} />
              )
            }
            style={[styles.resultRow, onRoster && styles.resultRowDim]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  title: { fontSize: 22, fontWeight: "700", marginTop: 16, marginHorizontal: 16 },
  subtitle: { fontSize: 13, marginHorizontal: 16, marginBottom: 12 },
  sectionTitle: { fontSize: 17, fontWeight: "700", marginHorizontal: 16, marginTop: 4, marginBottom: 8 },
  divider: { marginVertical: 16 },

  // Roster list
  rosterSection: { marginHorizontal: 8 },
  rosterCount: { fontSize: 13, marginLeft: 16, marginBottom: 4 },
  emptyText: { color: "#888", textAlign: "center", marginVertical: 20, fontSize: 14 },
  rosterRow: { borderBottomWidth: 1, borderBottomColor: "#f0f0f0" },
  playerName: { fontWeight: "600", fontSize: 14 },
  playerMeta: { fontSize: 12, color: "#888" },
  positionBadges: { flexDirection: "column", justifyContent: "center", gap: 2, paddingLeft: 8 },
  posBadge: { height: 20, marginVertical: 1 },
  posBadgeText: { fontSize: 9 },
  rowSpinner: { marginRight: 12, alignSelf: "center" },

  // Search
  searchPanel: { marginHorizontal: 8, marginBottom: 40 },
  searchBar: { marginHorizontal: 8, marginBottom: 8 },
  noResults: { color: "#888", textAlign: "center", margin: 16 },
  resultRow: { borderBottomWidth: 1, borderBottomColor: "#f0f0f0" },
  resultRowDim: { opacity: 0.5 },
  resultName: { fontWeight: "600", fontSize: 14 },
  dimText: { color: "#aaa" },
  onRosterText: { color: "#6750a4", fontSize: 12 },
  activeText: { color: "#2e7d32", fontSize: 12 },

  // Confirm
  confirmPanel: { margin: 16, padding: 16, backgroundColor: "#f5f0ff", borderRadius: 12 },
  confirmName: { fontSize: 18, fontWeight: "700", marginBottom: 4 },
  confirmMeta: { fontSize: 13, marginBottom: 12 },
  posLabel: { fontSize: 14, fontWeight: "600", marginBottom: 8 },
  posRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 },
  posChip: { marginBottom: 4 },
  confirmButtons: { flexDirection: "row", gap: 12, marginTop: 4 },
  cancelBtn: { flex: 1 },
  addBtn: { flex: 1 },
  spinner: { marginVertical: 16 },
  errorText: { color: "#c62828", fontSize: 13, marginTop: 8 },
  limitWarning: { color: "#e65100", fontSize: 13, fontWeight: "600", marginBottom: 8 },
});
