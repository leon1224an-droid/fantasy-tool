import React, { useState } from "react";
import { Platform, ScrollView, StyleSheet, View } from "react-native";
import {
  ActivityIndicator,
  Button,
  Chip,
  Divider,
  IconButton,
  Modal,
  Portal,
  Surface,
  Text,
  useTheme,
} from "react-native-paper";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getCalendar,
  getRoster,
  getSavedRosters,
  ingestAll,
  getActiveSource,
  setActiveSource,
  ingestYahooLeague,
  ingestBballMonster,
} from "../../lib/api";

const WEEK_DATES: Record<number, string> = {
  21: "Mar 16 – Mar 22",
  22: "Mar 23 – Mar 29",
  23: "Mar 30 – Apr 5",
};

const SOURCE_LABELS: Record<string, string> = {
  nba_api: "NBA API",
  yahoo: "Yahoo",
  bball_monster: "Basketball Monster",
  blended: "Blended",
};

export default function DashboardScreen() {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const [settingsOpen, setSettingsOpen] = useState(false);

  const { data: calendar, isLoading, error } = useQuery({
    queryKey: ["calendar"],
    queryFn: getCalendar,
  });

  const { data: roster } = useQuery({
    queryKey: ["roster"],
    queryFn: getRoster,
  });

  const { data: savedRosters } = useQuery({
    queryKey: ["saved-rosters"],
    queryFn: getSavedRosters,
  });

  const { data: sourceData } = useQuery({
    queryKey: ["projection-source"],
    queryFn: getActiveSource,
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["calendar"] });
    queryClient.invalidateQueries({ queryKey: ["schedule-all"] });
    queryClient.invalidateQueries({ queryKey: ["team-days"] });
    queryClient.invalidateQueries({ queryKey: ["player-grid"] });
    queryClient.invalidateQueries({ queryKey: ["roster"] });
    queryClient.invalidateQueries({ queryKey: ["league-teams"] });
    queryClient.invalidateQueries({ queryKey: ["league-rankings"] });
    queryClient.invalidateQueries({ queryKey: ["projection-source"] });
    queryClient.invalidateQueries({ queryKey: ["projections"] });
    queryClient.invalidateQueries({ queryKey: ["optimize"] });
  };

  // Single sync: Yahoo league + schedule/NBA API
  const syncMutation = useMutation({
    mutationFn: async () => {
      await ingestYahooLeague();
      await ingestAll();
    },
    onSuccess: invalidateAll,
  });

  const sourceMutation = useMutation({
    mutationFn: (source: string) => setActiveSource(source),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projection-source"] });
      queryClient.invalidateQueries({ queryKey: ["projections"] });
      queryClient.invalidateQueries({ queryKey: ["optimize"] });
      queryClient.invalidateQueries({ queryKey: ["league-rankings"] });
    },
  });

  const bmMutation = useMutation({
    mutationFn: (file: File) => ingestBballMonster(file),
    onSuccess: async () => {
      await setActiveSource("bball_monster");
      queryClient.invalidateQueries({ queryKey: ["projections"] });
      queryClient.invalidateQueries({ queryKey: ["projection-source"] });
      queryClient.invalidateQueries({ queryKey: ["optimize"] });
      queryClient.invalidateQueries({ queryKey: ["league-rankings"] });
    },
  });

  const handleBMUpload = () => {
    if (Platform.OS !== "web") return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".csv";
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) bmMutation.mutate(file);
    };
    input.click();
  };

  const activeRosterName = React.useMemo(() => {
    if (!roster || !savedRosters) return null;
    const activeNames = new Set(roster.filter((p) => !p.is_il).map((p) => p.name));
    for (const saved of savedRosters) {
      const savedNames = new Set(saved.players.map((p) => p.name));
      if (savedNames.size === activeNames.size && [...savedNames].every((n) => activeNames.has(n))) {
        return saved.name;
      }
    }
    return null;
  }, [roster, savedRosters]);

  const weekTotals = ([21, 22, 23] as const).map((wk) => {
    const weekData = calendar?.find((w) => w.week_num === wk);
    const total = weekData?.days.reduce((s, d) => s + d.players_available, 0) ?? 0;
    return { week: wk, total };
  });

  const anyPending = syncMutation.isPending || bmMutation.isPending || sourceMutation.isPending;

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Portal>
        <Modal
          visible={settingsOpen}
          onDismiss={() => setSettingsOpen(false)}
          contentContainerStyle={styles.modal}
        >
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Data &amp; Settings</Text>
            <IconButton icon="close" size={20} onPress={() => setSettingsOpen(false)} style={styles.modalClose} />
          </View>

          {/* Projection source */}
          <Text style={styles.modalLabel}>Projection Source</Text>
          <View style={styles.sourceRow}>
            {(sourceData?.valid_sources ?? []).map((src) => (
              <Chip
                key={src}
                selected={sourceData?.active_source === src}
                onPress={() => sourceMutation.mutate(src)}
                disabled={sourceMutation.isPending}
                compact
                showSelectedOverlay
                style={styles.sourceChip}
                textStyle={styles.sourceChipText}
              >
                {SOURCE_LABELS[src] ?? src}
              </Chip>
            ))}
          </View>
          {sourceMutation.isSuccess && (
            <Text style={styles.successMsg}>Source updated.</Text>
          )}

          <Divider style={styles.modalDivider} />

          {/* Sync button */}
          <Button
            mode="contained"
            icon="sync"
            onPress={() => syncMutation.mutate()}
            loading={syncMutation.isPending}
            disabled={anyPending}
            style={styles.modalBtn}
          >
            {syncMutation.isPending ? "Syncing…" : "Sync All"}
          </Button>
          {syncMutation.isSuccess && (
            <Text style={styles.successMsg}>Sync complete.</Text>
          )}
          {syncMutation.isError && (
            <Text style={styles.errorMsg}>{(syncMutation.error as Error).message}</Text>
          )}

          <Divider style={styles.modalDivider} />

          {/* Basketball Monster upload */}
          <Button
            mode="outlined"
            icon="upload"
            onPress={handleBMUpload}
            loading={bmMutation.isPending}
            disabled={anyPending || Platform.OS !== "web"}
            style={styles.modalBtn}
          >
            Upload Basketball Monster CSV
          </Button>
          {bmMutation.isSuccess && (
            <Text style={styles.successMsg}>
              Imported {(bmMutation.data as any)?.upserted ?? "?"} players.
            </Text>
          )}
          {bmMutation.isError && (
            <Text style={styles.errorMsg}>{(bmMutation.error as Error).message}</Text>
          )}
        </Modal>
      </Portal>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Heading row with settings cog */}
        <View style={styles.headingRow}>
          <Text style={[styles.heading, { color: theme.colors.onBackground }]}>Dashboard</Text>
          <IconButton
            icon="cog-outline"
            size={22}
            iconColor={theme.colors.onSurfaceVariant}
            onPress={() => setSettingsOpen(true)}
            style={styles.cogBtn}
          />
        </View>

        {activeRosterName && (
          <View style={styles.rosterBadge}>
            <Text style={styles.rosterBadgeLabel}>Active roster</Text>
            <Text style={styles.rosterBadgeName}>{activeRosterName}</Text>
          </View>
        )}

        {/* Active source pill */}
        {sourceData && (
          <View style={styles.sourcePill}>
            <Text style={styles.sourcePillLabel}>Source:</Text>
            <Text style={styles.sourcePillValue}>{SOURCE_LABELS[sourceData.active_source] ?? sourceData.active_source}</Text>
          </View>
        )}

        {isLoading && <ActivityIndicator style={{ marginTop: 24 }} />}
        {error && <Text style={styles.errorMsg}>{(error as Error).message}</Text>}

        {!isLoading && !error && (!calendar || calendar.length === 0) && (
          <Text style={styles.hintText}>No data yet — tap ⚙ to sync.</Text>
        )}

        {!isLoading && !error && calendar && calendar.length > 0 && (
          <Surface style={styles.card} elevation={1}>
            <Text style={styles.cardTitle}>Games This Playoff</Text>
            <View style={styles.cardDivider} />
            {weekTotals.map(({ week, total }) => (
              <View key={week} style={styles.weekRow}>
                <View>
                  <Text style={styles.weekLabel}>Week {week}</Text>
                  <Text style={styles.weekDates}>{WEEK_DATES[week]}</Text>
                </View>
                <Text style={styles.weekTotal}>{total} games</Text>
              </View>
            ))}
          </Surface>
        )}

        {roster && roster.length > 0 && (
          <Surface style={styles.card} elevation={1}>
            <Text style={styles.cardTitle}>My Roster ({roster.filter((p) => !p.is_il).length}/13{roster.some((p) => p.is_il) ? ` · IL ${roster.filter((p) => p.is_il).length}/3` : ""})</Text>
            <View style={styles.cardDivider} />
            {roster.map((player, idx) => (
              <View key={player.name} style={[styles.rosterRow, idx < roster.length - 1 && styles.rosterRowBorder]}>
                <View style={styles.rosterLeft}>
                  <Text style={styles.rosterPlayerName} numberOfLines={1}>{player.name}</Text>
                  <View style={styles.rosterMeta}>
                    <Text style={styles.rosterTeam}>{player.team}</Text>
                    <Text style={styles.rosterDot}>·</Text>
                    <Text style={styles.rosterPositions}>{player.positions.join(" / ")}</Text>
                  </View>
                </View>
                {player.is_il && (
                  <View style={styles.ilTag}><Text style={styles.ilTagText}>IL</Text></View>
                )}
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

  headingRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  heading: { fontSize: 24, fontWeight: "800", letterSpacing: -0.5 },
  cogBtn: { margin: 0 },

  rosterBadge: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "#ede7f6", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8,
  },
  rosterBadgeLabel: { fontSize: 12, color: "#7e57c2", fontWeight: "600" },
  rosterBadgeName: { fontSize: 14, color: "#4a148c", fontWeight: "800" },

  sourcePill: {
    flexDirection: "row", alignItems: "center", gap: 6,
    alignSelf: "flex-start", backgroundColor: "#f3f0fa",
    borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5,
  },
  sourcePillLabel: { fontSize: 12, color: "#7e57c2" },
  sourcePillValue: { fontSize: 12, fontWeight: "700", color: "#4a148c" },

  hintText: { color: "#888", textAlign: "center", fontSize: 13, marginTop: 12 },

  card: { borderRadius: 16, backgroundColor: "#fff", overflow: "hidden" },
  cardTitle: { fontSize: 15, fontWeight: "700", color: "#1a1a1a", padding: 18, paddingBottom: 12 },
  cardDivider: { height: StyleSheet.hairlineWidth, backgroundColor: "#f0f0f0", marginHorizontal: 18 },

  weekRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 18, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#f0f0f0",
  },
  weekLabel: { fontSize: 15, fontWeight: "600", color: "#1a1a1a" },
  weekDates: { fontSize: 12, color: "#888", marginTop: 2 },
  weekTotal: { fontSize: 22, fontWeight: "800", color: "#6750a4" },

  rosterRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 18, paddingVertical: 12 },
  rosterRowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#f0f0f0" },
  rosterLeft: { flex: 1 },
  rosterPlayerName: { fontSize: 14, fontWeight: "600", color: "#1a1a1a", marginBottom: 2 },
  rosterMeta: { flexDirection: "row", alignItems: "center", gap: 4 },
  rosterTeam: { fontSize: 12, color: "#888" },
  rosterDot: { fontSize: 12, color: "#ccc" },
  rosterPositions: { fontSize: 12, fontWeight: "600", color: "#6750a4" },
  ilTag: { backgroundColor: "#e65100", borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2, marginLeft: 8 },
  ilTagText: { color: "#fff", fontSize: 10, fontWeight: "700" },

  // Modal
  modal: {
    margin: 20, borderRadius: 20, backgroundColor: "#fff", padding: 20,
    maxWidth: 480, alignSelf: "center", width: "100%",
  },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
  modalTitle: { fontSize: 17, fontWeight: "700", color: "#1a1a1a" },
  modalClose: { margin: 0 },
  modalLabel: { fontSize: 12, fontWeight: "600", color: "#666", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 },
  sourceRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 4 },
  sourceChip: {},
  sourceChipText: { fontSize: 12 },
  modalDivider: { marginVertical: 16 },
  modalBtn: { borderRadius: 10 },
  successMsg: { color: "#2e7d32", fontSize: 12, marginTop: 6 },
  errorMsg: { color: "#c62828", fontSize: 12, marginTop: 6 },
});
