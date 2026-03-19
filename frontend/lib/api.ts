import { BASE_URL } from "../constants/config";
import { tokenStorage } from "./tokenStorage";

// ---------------------------------------------------------------------------
// TypeScript interfaces matching FastAPI Pydantic models
// ---------------------------------------------------------------------------

export interface SlotAssignment {
  slot: string;
  player: string;
  projected_total: number;
}

export interface WeeklyLineupResponse {
  week_num: number;
  starters: SlotAssignment[];
  bench: string[];
  total_projected: number;
}

export interface ScheduleRow {
  team: string;
  week_num: number;
  week_start: string;
  week_end: string;
  games_count: number;
}

export interface ProjectionRow {
  player: string;
  team: string;
  week_num: number;
  games_count: number;
  pts_pg: number;
  reb_pg: number;
  ast_pg: number;
  stl_pg: number;
  blk_pg: number;
  tov_pg: number;
  tpm_pg: number;
  fg_pct: number;
  ft_pct: number;
  fantasy_ppg: number;
  projected_total: number;
}

export interface HealthResponse {
  status: string;
}

// Calendar
export interface DailySlot {
  slot: string;
  player: string | null;
}

export interface DailyLineupResponse {
  date: string;
  day_label: string;
  players_available: number;
  players_starting: number;
  lineup: DailySlot[];
  benched: string[];
  all_starting: boolean;
}

export interface WeeklyCalendarResponse {
  week_num: number;
  week_dates: string;
  days: DailyLineupResponse[];
}

// Player grid
export interface PlayerDayCell {
  date: string;
  day_label: string;
  week_num: number;
  has_game: boolean;
  is_starting: boolean;
}

export interface PlayerGridRow {
  player: string;
  team: string;
  positions: string[];
  days: PlayerDayCell[];
  raw_totals: Record<string, number>;
  playable_totals: Record<string, number>;
  raw_grand_total: number;
  playable_grand_total: number;
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

/** Injected by AuthProvider after a successful token refresh. */
let _onTokenRefreshed: ((token: string) => void) | null = null;
export function setTokenRefreshCallback(cb: (token: string) => void) {
  _onTokenRefreshed = cb;
}

async function _refreshToken(): Promise<string | null> {
  try {
    const res = await fetch(`${BASE_URL}/auth/refresh`, {
      method: "POST",
      credentials: "include",
    });
    if (!res.ok) return null;
    const data: { access_token: string } = await res.json();
    return data.access_token;
  } catch {
    return null;
  }
}

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = await tokenStorage.get();
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> ?? {}),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  let res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
    credentials: "include",
  });

  // Auto-refresh on 401 and retry once
  if (res.status === 401 && token) {
    const fresh = await _refreshToken();
    if (fresh) {
      await tokenStorage.set(fresh);
      _onTokenRefreshed?.(fresh);
      res = await fetch(`${BASE_URL}${path}`, {
        ...options,
        headers: { ...headers, Authorization: `Bearer ${fresh}` },
        credentials: "include",
      });
    }
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Auth endpoints
// ---------------------------------------------------------------------------
export interface UserProfile {
  id: number;
  email: string;
  username: string;
  is_active: boolean;
  is_admin: boolean;
  yahoo_league_id: string | null;
  yahoo_linked: boolean;
  nba_projections_fetched_at: string | null;
}

export function getMe(): Promise<UserProfile> {
  return apiFetch<UserProfile>("/auth/me");
}

export function updateYahooLeagueId(yahoo_league_id: string): Promise<UserProfile> {
  return apiFetch<UserProfile>("/auth/me/yahoo", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ yahoo_league_id }),
  });
}

export function getYahooLink(): Promise<{ auth_url: string }> {
  return apiFetch<{ auth_url: string }>("/auth/yahoo/link");
}

export function unlinkYahoo(): Promise<UserProfile> {
  return apiFetch<UserProfile>("/auth/me/yahoo", { method: "DELETE" });
}

export function getOptimize(week?: number): Promise<WeeklyLineupResponse[]> {
  const query = week != null ? `?week=${week}` : "";
  return apiFetch<WeeklyLineupResponse[]>(`/optimize${query}`);
}

export function getSchedule(): Promise<ScheduleRow[]> {
  return apiFetch<ScheduleRow[]>("/schedule");
}

export function getAllSchedule(): Promise<ScheduleRow[]> {
  return apiFetch<ScheduleRow[]>("/schedule/all");
}

export interface TeamDayRow {
  team: string;
  date: string;
  week_num: number;
  day_label: string;
}

export function getTeamDays(): Promise<TeamDayRow[]> {
  return apiFetch<TeamDayRow[]>("/team-days");
}

export function getProjections(week?: number): Promise<ProjectionRow[]> {
  const query = week != null ? `?week=${week}` : "";
  return apiFetch<ProjectionRow[]>(`/projections${query}`);
}

export async function ingestAll(): Promise<void> {
  await apiFetch<unknown>("/ingest/all", { method: "POST" });
}

export function getHealth(): Promise<HealthResponse> {
  return apiFetch<HealthResponse>("/health");
}

export function getCalendar(): Promise<WeeklyCalendarResponse[]> {
  return apiFetch<WeeklyCalendarResponse[]>("/calendar");
}

export function getPlayerGrid(): Promise<PlayerGridRow[]> {
  return apiFetch<PlayerGridRow[]>("/player-grid");
}

// Roster management
export interface NBAPlayerSearchResult {
  player_id: number;
  name: string;
  is_active: boolean;
}

export interface NBAPlayerInfo {
  player_id: number;
  name: string;
  team: string;
  nba_position: string;
  positions: string[];
}

export interface RosterPlayer {
  name: string;
  team: string;
  positions: string[];
  is_active: boolean;
  is_il: boolean;
}

export function getRoster(): Promise<RosterPlayer[]> {
  return apiFetch<RosterPlayer[]>("/roster");
}

export function searchPlayers(q: string): Promise<NBAPlayerSearchResult[]> {
  return apiFetch<NBAPlayerSearchResult[]>(`/players/search?q=${encodeURIComponent(q)}`);
}

export function getPlayerInfo(playerId: number): Promise<NBAPlayerInfo> {
  return apiFetch<NBAPlayerInfo>(`/players/info/${playerId}`);
}

export function addToRoster(body: {
  player_id: number;
  name: string;
  team: string;
  positions: string[];
}): Promise<RosterPlayer> {
  return apiFetch<RosterPlayer>("/roster", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function removeFromRoster(playerName: string): Promise<void> {
  return apiFetch<void>(`/roster/${encodeURIComponent(playerName)}`, {
    method: "DELETE",
  });
}

export function clearRoster(): Promise<void> {
  return apiFetch<void>("/roster", { method: "DELETE" });
}

// Saved rosters
export interface SavedRosterEntry {
  name: string;
  team: string;
  positions: string[];
}

export interface SavedRosterSchema {
  id: number;
  name: string;
  players: SavedRosterEntry[];
  created_at: string;
}

export function getSavedRosters(): Promise<SavedRosterSchema[]> {
  return apiFetch<SavedRosterSchema[]>("/saved-rosters");
}

export function createSavedRoster(
  name: string,
  players: SavedRosterEntry[]
): Promise<SavedRosterSchema> {
  return apiFetch<SavedRosterSchema>("/saved-rosters", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, players }),
  });
}

export function updateSavedRoster(
  id: number,
  name: string,
  players: SavedRosterEntry[]
): Promise<SavedRosterSchema> {
  return apiFetch<SavedRosterSchema>(`/saved-rosters/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, players }),
  });
}

export function deleteSavedRoster(id: number): Promise<void> {
  return apiFetch<void>(`/saved-rosters/${id}`, { method: "DELETE" });
}

export function activateSavedRoster(id: number): Promise<RosterPlayer[]> {
  return apiFetch<RosterPlayer[]>(`/saved-rosters/${id}/activate`, { method: "POST" });
}

// Schedule simulation
export interface PlayerWeekStarts {
  week_num: number;
  starts: number;
  raw_games: number;
}

export interface SimulatePlayerResult {
  name: string;
  team: string;
  weeks: PlayerWeekStarts[];
  total_starts: number;
  total_raw_games: number;
}

export interface SimulateScheduleResponse {
  players: SimulatePlayerResult[];
}

export function simulateSchedule(players: { name: string; team: string; positions: string[] }[]): Promise<SimulateScheduleResponse> {
  return apiFetch<SimulateScheduleResponse>("/simulate-schedule", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ players }),
  });
}

export function setPlayerIL(playerName: string, isIL: boolean): Promise<RosterPlayer> {
  return apiFetch<RosterPlayer>(`/roster/${encodeURIComponent(playerName)}/il`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ is_il: isIL }),
  });
}

export function updateRosterPositions(
  playerName: string,
  positions: string[]
): Promise<RosterPlayer> {
  return apiFetch<RosterPlayer>(
    `/roster/${encodeURIComponent(playerName)}/positions`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ positions }),
    }
  );
}

// ---------------------------------------------------------------------------
// Projection source
// ---------------------------------------------------------------------------
export interface ProjectionSourceResponse {
  active_source: string;
  valid_sources: string[];
}

export function getActiveSource(): Promise<ProjectionSourceResponse> {
  return apiFetch<ProjectionSourceResponse>("/projections/source");
}

export function setActiveSource(source: string): Promise<ProjectionSourceResponse> {
  return apiFetch<ProjectionSourceResponse>("/projections/source", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source }),
  });
}

export interface BlendResponse {
  status: string;
  players_blended: number;
}

export function blendProjections(weights: Record<string, number>): Promise<BlendResponse> {
  return apiFetch<BlendResponse>("/projections/blend", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ weights }),
  });
}

// ---------------------------------------------------------------------------
// Extended ingestion
// ---------------------------------------------------------------------------
export function ingestYahooLeague(): Promise<{ status: string; teams_upserted: number; players_upserted: number }> {
  return apiFetch("/ingest/yahoo-league", { method: "POST" });
}

export async function ingestBballMonster(file: File): Promise<{ status: string; upserted: number; skipped: number }> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`${BASE_URL}/ingest/bball-monster`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// League
// ---------------------------------------------------------------------------
export interface RosterEntry {
  name: string;
  team: string;
  positions: string[];
  is_il: boolean;
}

export interface LeagueTeamResponse {
  team_key: string;
  team_name: string;
  manager_name: string | null;
  roster: RosterEntry[];
  fetched_at: string;
}

export interface TeamRankingResponse {
  rank: number;
  team_key: string;
  team_name: string;
  proj_wins: number;
  total_games: number;
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  tov: number;
  tpm: number;
  fg_pct: number;
  ft_pct: number;
}

export interface CategoryResult {
  category: string;
  a_value: number;
  b_value: number;
  winner: string;
  margin: number;
}

export interface MatchupResult {
  team_a: string;
  team_b: string;
  week_num: number;
  categories: CategoryResult[];
  a_wins: number;
  b_wins: number;
  ties: number;
  a_games: number;
  b_games: number;
}

export function loadYahooTeamToRoster(teamKey: string): Promise<RosterPlayer[]> {
  return apiFetch<RosterPlayer[]>("/roster/load-yahoo-team", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ team_key: teamKey }),
  });
}

export function getLeagueTeams(): Promise<LeagueTeamResponse[]> {
  return apiFetch<LeagueTeamResponse[]>("/league/teams");
}

export function getLeagueRankings(week: number): Promise<TeamRankingResponse[]> {
  return apiFetch<TeamRankingResponse[]>(`/league/rankings?week=${week}`);
}

export function getLeagueMatchup(
  teamA: string, teamB: string, week: number,
  excludeA: string[] = [], excludeB: string[] = [],
): Promise<MatchupResult> {
  const params = new URLSearchParams({ team_a: teamA, team_b: teamB, week: String(week) });
  if (excludeA.length) params.set("exclude_a", excludeA.join(","));
  if (excludeB.length) params.set("exclude_b", excludeB.join(","));
  return apiFetch<MatchupResult>(`/league/matchup?${params}`);
}

export interface ScheduledMatchup {
  team_a_key: string;
  team_a_name: string;
  team_b_key: string;
  team_b_name: string;
}

export function getLeagueMatchups(week: number): Promise<ScheduledMatchup[]> {
  return apiFetch<ScheduledMatchup[]>(`/league/matchups?week=${week}`);
}
