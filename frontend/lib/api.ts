import { BASE_URL } from "../constants/config";

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

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, options);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export function getOptimize(week?: number): Promise<WeeklyLineupResponse[]> {
  const query = week != null ? `?week=${week}` : "";
  return apiFetch<WeeklyLineupResponse[]>(`/optimize${query}`);
}

export function getSchedule(): Promise<ScheduleRow[]> {
  return apiFetch<ScheduleRow[]>("/schedule");
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
