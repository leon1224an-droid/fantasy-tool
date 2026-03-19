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
  getYahooLink,
} from "../../lib/api";
import { useAuth } from "../../lib/authContext";

const SOURCE_LABELS: Record<string, string> = {
  nba_api: "NBA API",
  yahoo: "Yahoo",
  bball_monster: "BBall Monster",
  blended: "Blended",
};

// ---------------------------------------------------------------------------
// Nav tile inside each feature card
// ---------------------------------------------------------------------------
function NavTile({
  icon,
  label,
  accent,
  onPress,
}: {
  icon: string;
  label: string;
  accent: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.navTile, pressed && styles.navTilePressed]}
    >
      <View style={[styles.navTileIcon, { backgroundColor: accent + "18" }]}>
        <MaterialCommunityIcons name={icon as any} size={20} color={accent} />
      </View>
      <Text style={[styles.navTileLabel, { color: accent }]}>{label}</Text>
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
  const { user, logout } = useAuth();
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

  const yahooLinkMutation = useMutation({
    mutationFn: async () => {
      const { auth_url } = await getYahooLink();
      if (Platform.OS === "web") window.open(auth_url, "_blank");
    },
  });

  const handleLogout = async () => {
    setSettingsOpen(false);
    await logout();
  };

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

  const hasCalendar = !!calendar && calendar.length > 0;
  const activeRoster = roster?.filter((p) => !p.is_il) ?? [];

  // Roster badge label
  const rosterLabel = activeRosterName
    ? `${activeRosterName} · ${activeRoster.length}p`
    : activeRoster.length > 0
      ? `${activeRoster.length} players`
      : null;

  // Source badge label
  const sourceLabel = sourceData
    ? SOURCE_LABELS[sourceData.active_source] ?? sourceData.active_source
    : null;

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

          <Divider style={styles.modalDivider} />

          <Text style={styles.modalLabel}>Account</Text>
          {user && (
            <Text style={{ fontSize: 13, color: "#555", marginBottom: 10 }}>
              Signed in as <Text style={{ fontWeight: "700" }}>{user.username}</Text>
              {" "}({user.email})
              {"\n"}
              <Text style={{ color: user.yahoo_linked ? "#2e7d32" : "#999", fontSize: 12 }}>
                Yahoo: {user.yahoo_linked ? `Linked · League ${user.yahoo_league_id ?? "not set"}` : "Not linked"}
              </Text>
            </Text>
          )}
          {!user?.yahoo_linked && (
            <Button mode="outlined" icon="link" onPress={() => yahooLinkMutation.mutate()}
              loading={yahooLinkMutation.isPending} disabled={anyPending} style={styles.modalBtn}>
              Link Yahoo Account
            </Button>
          )}
          <Button mode="outlined" icon="logout" onPress={handleLogout}
            disabled={anyPending} style={[styles.modalBtn, { borderColor: "#c62828" }]}
            textColor="#c62828">
            Sign Out
          </Button>
        </Modal>
      </Portal>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={[styles.heading, { color: theme.colors.onBackground }]}>Fantasy Playoff</Text>
            <Text style={styles.subheading}>2026 Playoff Optimizer</Text>
          </View>
          <IconButton icon="cog-outline" size={22} iconColor={theme.colors.onSurfaceVariant}
            onPress={() => setSettingsOpen(true)} style={styles.cogBtn} />
        </View>

        {calLoading && <ActivityIndicator style={{ marginTop: 24 }} />}

        {!calLoading && !hasCalendar && (
          <Surface style={styles.emptyCard} elevation={0}>
            <View style={styles.emptyIconWrap}>
              <MaterialCommunityIcons name="database-off-outline" size={28} color="#bbb" />
            </View>
            <Text style={styles.emptyText}>No data yet</Text>
            <Text style={styles.emptyHint}>Tap ⚙ above and choose Sync All to load schedule &amp; league data.</Text>
          </Surface>
        )}

        {/* ── SCHEDULE OPTIMIZER ─────────────────────────────────── */}
        <Surface style={styles.featureCard} elevation={2}>
          <View style={[styles.cardBand, { backgroundColor: "#6750a4" }]}>
            <View style={styles.bandLeft}>
              <View style={styles.bandIconWrap}>
                <MaterialCommunityIcons name="calendar-check" size={22} color="#fff" />
              </View>
              <View>
                <Text style={styles.bandTitle}>Schedule Optimizer</Text>
                <Text style={styles.bandSub}>Maximize playoff starts</Text>
              </View>
            </View>
            {rosterLabel && (
              <View style={styles.bandBadge}>
                <Text style={styles.bandBadgeText}>{rosterLabel}</Text>
              </View>
            )}
          </View>

          <View style={styles.navGrid}>
            <NavTile icon="account-group" label="Roster" accent="#6750a4" onPress={() => router.push("/(tabs)/roster")} />
            <NavTile icon="calendar-today" label="Calendar" accent="#6750a4" onPress={() => router.push("/(tabs)/calendar")} />
            <NavTile icon="grid" label="Grid" accent="#6750a4" onPress={() => router.push("/(tabs)/player-grid")} />
            <NavTile icon="scale-balance" label="Compare" accent="#6750a4" onPress={() => router.push("/(tabs)/compare")} />
          </View>
        </Surface>

        {/* ── LEAGUE ANALYSIS ────────────────────────────────────── */}
        <Surface style={styles.featureCard} elevation={2}>
          <View style={[styles.cardBand, { backgroundColor: "#1b5e20" }]}>
            <View style={styles.bandLeft}>
              <View style={styles.bandIconWrap}>
                <MaterialCommunityIcons name="tournament" size={22} color="#fff" />
              </View>
              <View>
                <Text style={styles.bandTitle}>League Analysis</Text>
                <Text style={styles.bandSub}>Rankings &amp; H2H projections</Text>
              </View>
            </View>
            {sourceLabel && (
              <View style={styles.bandBadge}>
                <Text style={styles.bandBadgeText}>{sourceLabel}</Text>
              </View>
            )}
          </View>

          <View style={styles.navGrid}>
            <NavTile icon="trophy-outline" label="Rankings" accent="#2e7d32" onPress={() => router.push("/(tabs)/league")} />
            <NavTile icon="sword-cross" label="H2H" accent="#2e7d32" onPress={() => router.push("/(tabs)/matchup")} />
            <NavTile icon="calendar-month" label="Teams" accent="#2e7d32" onPress={() => router.push("/(tabs)/teams")} />
          </View>
        </Surface>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, paddingBottom: 40, gap: 16 },

  // Header
  header: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 4 },
  heading: { fontSize: 22, fontWeight: "900", letterSpacing: -0.5 },
  subheading: { fontSize: 12, color: "#999", fontWeight: "500", marginTop: 1 },
  cogBtn: { margin: 0, marginTop: -2 },

  // Empty state
  emptyCard: {
    borderRadius: 18, backgroundColor: "#f5f5f5",
    padding: 32, alignItems: "center", gap: 8,
  },
  emptyIconWrap: {
    width: 56, height: 56, borderRadius: 16,
    backgroundColor: "#ebebeb", alignItems: "center", justifyContent: "center", marginBottom: 4,
  },
  emptyText: { fontSize: 15, fontWeight: "700", color: "#999" },
  emptyHint: { fontSize: 12, color: "#bbb", textAlign: "center", lineHeight: 18 },

  // Feature cards
  featureCard: { borderRadius: 20, backgroundColor: "#fff", overflow: "hidden" },

  // Colored band header
  cardBand: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingVertical: 16,
  },
  bandLeft: { flexDirection: "row", alignItems: "center", gap: 12 },
  bandIconWrap: {
    width: 42, height: 42, borderRadius: 13,
    backgroundColor: "rgba(255,255,255,0.18)", alignItems: "center", justifyContent: "center",
  },
  bandTitle: { fontSize: 16, fontWeight: "800", color: "#fff", letterSpacing: -0.2 },
  bandSub: { fontSize: 11, color: "rgba(255,255,255,0.72)", marginTop: 2 },
  bandBadge: {
    backgroundColor: "rgba(255,255,255,0.18)", borderRadius: 20,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  bandBadgeText: { fontSize: 11, fontWeight: "700", color: "#fff" },

  // Nav tile grid
  navGrid: { flexDirection: "row", padding: 12, gap: 8 },
  navTile: {
    flex: 1, alignItems: "center", gap: 6,
    paddingVertical: 12, borderRadius: 14, backgroundColor: "#fafafa",
  },
  navTilePressed: { backgroundColor: "#f0f0f0" },
  navTileIcon: {
    width: 38, height: 38, borderRadius: 11,
    alignItems: "center", justifyContent: "center",
  },
  navTileLabel: { fontSize: 11, fontWeight: "700", textAlign: "center" },

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
