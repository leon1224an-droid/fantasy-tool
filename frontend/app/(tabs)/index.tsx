import React, { useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
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
import { useRouter } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { MaterialCommunityIcons } from "@expo/vector-icons";
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
  21: "Mar 16–22",
  22: "Mar 23–29",
  23: "Mar 30–Apr 5",
};

const SOURCE_LABELS: Record<string, string> = {
  nba_api: "NBA API",
  yahoo: "Yahoo",
  bball_monster: "Basketball Monster",
  blended: "Blended",
};

// ---------------------------------------------------------------------------
// Nav button used inside each feature card
// ---------------------------------------------------------------------------
function NavButton({
  icon,
  label,
  onPress,
}: {
  icon: string;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.navBtn, pressed && styles.navBtnPressed]}>
      <MaterialCommunityIcons name={icon as any} size={20} color="#6750a4" />
      <Text style={styles.navBtnLabel}>{label}</Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------
export default function HomeScreen() {
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [settingsOpen, setSettingsOpen] = useState(false);

  const { data: calendar, isLoading: calLoading } = useQuery({
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
    ["calendar","schedule-all","team-days","player-grid","roster",
     "league-teams","league-rankings","projection-source","projections","optimize"]
      .forEach((k) => queryClient.invalidateQueries({ queryKey: [k] }));
  };

  const syncMutation = useMutation({
    mutationFn: async () => { await ingestYahooLeague(); await ingestAll(); },
    onSuccess: invalidateAll,
  });

  const sourceMutation = useMutation({
    mutationFn: (source: string) => setActiveSource(source),
    onSuccess: () => {
      ["projection-source","projections","optimize","league-rankings"]
        .forEach((k) => queryClient.invalidateQueries({ queryKey: [k] }));
    },
  });

  const bmMutation = useMutation({
    mutationFn: (file: File) => ingestBballMonster(file),
    onSuccess: async () => {
      await setActiveSource("bball_monster");
      ["projections","projection-source","optimize","league-rankings"]
        .forEach((k) => queryClient.invalidateQueries({ queryKey: [k] }));
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

  const anyPending = syncMutation.isPending || bmMutation.isPending || sourceMutation.isPending;

  // Active roster name
  const activeRosterName = React.useMemo(() => {
    if (!roster || !savedRosters) return null;
    const activeNames = new Set(roster.filter((p) => !p.is_il).map((p) => p.name));
    for (const saved of savedRosters) {
      const savedNames = new Set(saved.players.map((p) => p.name));
      if (savedNames.size === activeNames.size && [...savedNames].every((n) => activeNames.has(n)))
        return saved.name;
    }
    return null;
  }, [roster, savedRosters]);

  // Starts per week from calendar
  const weekStarts = ([21, 22, 23] as const).map((wk) => {
    const weekData = calendar?.find((w) => w.week_num === wk);
    return {
      week: wk,
      starts: weekData?.days.reduce((s, d) => s + d.players_starting, 0) ?? 0,
    };
  });

  const hasCalendar = !!calendar && calendar.length > 0;
  const activeRoster = roster?.filter((p) => !p.is_il) ?? [];

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {/* ── Settings modal ─────────────────────────────────────────── */}
      <Portal>
        <Modal visible={settingsOpen} onDismiss={() => setSettingsOpen(false)} contentContainerStyle={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Data &amp; Settings</Text>
            <IconButton icon="close" size={20} onPress={() => setSettingsOpen(false)} style={styles.modalClose} />
          </View>

          <Text style={styles.modalLabel}>Projection Source</Text>
          <View style={styles.sourceRow}>
            {(sourceData?.valid_sources ?? []).map((src) => (
              <Chip
                key={src}
                selected={sourceData?.active_source === src}
                onPress={() => sourceMutation.mutate(src)}
                disabled={sourceMutation.isPending}
                compact showSelectedOverlay
                textStyle={{ fontSize: 12 }}
              >
                {SOURCE_LABELS[src] ?? src}
              </Chip>
            ))}
          </View>
          {sourceMutation.isSuccess && <Text style={styles.successMsg}>Source updated.</Text>}

          <Divider style={styles.modalDivider} />

          <Button mode="contained" icon="sync" onPress={() => syncMutation.mutate()}
            loading={syncMutation.isPending} disabled={anyPending} style={styles.modalBtn}>
            {syncMutation.isPending ? "Syncing…" : "Sync All"}
          </Button>
          {syncMutation.isSuccess && <Text style={styles.successMsg}>Sync complete.</Text>}
          {syncMutation.isError && <Text style={styles.errorMsg}>{(syncMutation.error as Error).message}</Text>}

          <Divider style={styles.modalDivider} />

          <Button mode="outlined" icon="upload" onPress={handleBMUpload}
            loading={bmMutation.isPending} disabled={anyPending || Platform.OS !== "web"} style={styles.modalBtn}>
            Upload Basketball Monster CSV
          </Button>
          {bmMutation.isSuccess && <Text style={styles.successMsg}>Imported {(bmMutation.data as any)?.upserted ?? "?"} players.</Text>}
          {bmMutation.isError && <Text style={styles.errorMsg}>{(bmMutation.error as Error).message}</Text>}
        </Modal>
      </Portal>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={[styles.heading, { color: theme.colors.onBackground }]}>Fantasy Playoff</Text>
          <IconButton icon="cog-outline" size={22} iconColor={theme.colors.onSurfaceVariant}
            onPress={() => setSettingsOpen(true)} style={styles.cogBtn} />
        </View>

        {calLoading && <ActivityIndicator style={{ marginTop: 24 }} />}

        {!calLoading && !hasCalendar && (
          <Surface style={styles.emptyCard} elevation={1}>
            <MaterialCommunityIcons name="database-off-outline" size={32} color="#bbb" />
            <Text style={styles.emptyText}>No data yet</Text>
            <Text style={styles.emptyHint}>Open ⚙ and tap Sync All to load schedule &amp; league data.</Text>
          </Surface>
        )}

        {/* ── SCHEDULE OPTIMIZER ─────────────────────────────────── */}
        <Surface style={styles.featureCard} elevation={1}>
          {/* Card header */}
          <View style={styles.featureHeader}>
            <View style={[styles.featureIcon, { backgroundColor: "#ede7f6" }]}>
              <MaterialCommunityIcons name="calendar-check" size={20} color="#6750a4" />
            </View>
            <View style={styles.featureTitleGroup}>
              <Text style={styles.featureTitle}>Schedule Optimizer</Text>
              <Text style={styles.featureSub}>Maximize your playoff starts</Text>
            </View>
          </View>

          {/* Active roster context */}
          <View style={styles.contextRow}>
            {activeRosterName ? (
              <Text style={styles.contextPill}>
                📋 {activeRosterName} · {activeRoster.length} players
              </Text>
            ) : roster && roster.length > 0 ? (
              <Text style={styles.contextPill}>
                📋 {activeRoster.length} players active
              </Text>
            ) : (
              <Text style={styles.contextEmpty}>No roster — go to Roster tab to add players</Text>
            )}
          </View>

          {/* Week starts inline */}
          {hasCalendar && (
            <View style={styles.weekStatsRow}>
              {weekStarts.map(({ week, starts }) => (
                <View key={week} style={styles.weekStat}>
                  <Text style={styles.weekStatNum}>{starts}</Text>
                  <Text style={styles.weekStatLabel}>Wk {week}</Text>
                  <Text style={styles.weekStatDate}>{WEEK_DATES[week]}</Text>
                </View>
              ))}
            </View>
          )}

          <Divider style={styles.navDivider} />

          {/* Nav buttons */}
          <View style={styles.navRow}>
            <NavButton icon="account-group" label="Roster" onPress={() => router.push("/(tabs)/roster")} />
            <NavButton icon="calendar-today" label="Calendar" onPress={() => router.push("/(tabs)/calendar")} />
            <NavButton icon="grid" label="Grid" onPress={() => router.push("/(tabs)/player-grid")} />
            <NavButton icon="scale-balance" label="Compare" onPress={() => router.push("/(tabs)/compare")} />
          </View>
        </Surface>

        {/* ── LEAGUE ANALYSIS ────────────────────────────────────── */}
        <Surface style={styles.featureCard} elevation={1}>
          {/* Card header */}
          <View style={styles.featureHeader}>
            <View style={[styles.featureIcon, { backgroundColor: "#e8f5e9" }]}>
              <MaterialCommunityIcons name="tournament" size={20} color="#2e7d32" />
            </View>
            <View style={styles.featureTitleGroup}>
              <Text style={styles.featureTitle}>League Analysis</Text>
              <Text style={styles.featureSub}>Rankings &amp; H2H projections</Text>
            </View>
          </View>

          {/* Projection source context */}
          <View style={styles.contextRow}>
            {sourceData ? (
              <Text style={styles.contextPill}>
                📊 {SOURCE_LABELS[sourceData.active_source] ?? sourceData.active_source}
              </Text>
            ) : (
              <Text style={styles.contextEmpty}>No projection source — sync first</Text>
            )}
          </View>

          <Divider style={styles.navDivider} />

          {/* Nav buttons */}
          <View style={styles.navRow}>
            <NavButton icon="trophy-outline" label="Rankings" onPress={() => router.push("/(tabs)/league")} />
            <NavButton icon="sword-cross" label="H2H" onPress={() => router.push("/(tabs)/matchup")} />
            <NavButton icon="calendar-month" label="Teams" onPress={() => router.push("/(tabs)/teams")} />
          </View>
        </Surface>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, paddingBottom: 40, gap: 14 },

  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 2 },
  heading: { fontSize: 20, fontWeight: "800", letterSpacing: -0.4 },
  cogBtn: { margin: 0 },

  // Empty state
  emptyCard: {
    borderRadius: 16, backgroundColor: "#fff", padding: 32,
    alignItems: "center", gap: 8,
  },
  emptyText: { fontSize: 15, fontWeight: "600", color: "#aaa" },
  emptyHint: { fontSize: 12, color: "#bbb", textAlign: "center" },

  // Feature cards
  featureCard: { borderRadius: 16, backgroundColor: "#fff", overflow: "hidden", paddingBottom: 4 },
  featureHeader: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16, paddingBottom: 10 },
  featureIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  featureTitleGroup: { flex: 1 },
  featureTitle: { fontSize: 15, fontWeight: "700", color: "#1a1a1a" },
  featureSub: { fontSize: 12, color: "#888", marginTop: 1 },

  // Context row (roster name / source)
  contextRow: { paddingHorizontal: 16, paddingBottom: 10 },
  contextPill: { fontSize: 13, color: "#555", fontWeight: "500" },
  contextEmpty: { fontSize: 12, color: "#bbb", fontStyle: "italic" },

  // Week stats (schedule card only)
  weekStatsRow: {
    flexDirection: "row", paddingHorizontal: 16, paddingBottom: 12, gap: 0,
  },
  weekStat: { flex: 1, alignItems: "center" },
  weekStatNum: { fontSize: 22, fontWeight: "800", color: "#6750a4", lineHeight: 26 },
  weekStatLabel: { fontSize: 11, fontWeight: "700", color: "#555", marginTop: 1 },
  weekStatDate: { fontSize: 10, color: "#aaa", marginTop: 1 },

  navDivider: { marginHorizontal: 12 },

  // Nav buttons inside cards
  navRow: { flexDirection: "row", paddingHorizontal: 8, paddingVertical: 8, gap: 4 },
  navBtn: {
    flex: 1, alignItems: "center", paddingVertical: 8, borderRadius: 10, gap: 4,
  },
  navBtnPressed: { backgroundColor: "#f3f0fa" },
  navBtnLabel: { fontSize: 11, fontWeight: "600", color: "#6750a4", textAlign: "center" },

  // Settings modal
  modal: { margin: 20, borderRadius: 20, backgroundColor: "#fff", padding: 20, maxWidth: 480, alignSelf: "center", width: "100%" },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
  modalTitle: { fontSize: 17, fontWeight: "700", color: "#1a1a1a" },
  modalClose: { margin: 0 },
  modalLabel: { fontSize: 12, fontWeight: "600", color: "#666", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 },
  sourceRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 4 },
  modalDivider: { marginVertical: 16 },
  modalBtn: { borderRadius: 10 },
  successMsg: { color: "#2e7d32", fontSize: 12, marginTop: 6 },
  errorMsg: { color: "#c62828", fontSize: 12, marginTop: 6 },
});
