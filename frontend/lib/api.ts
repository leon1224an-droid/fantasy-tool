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
