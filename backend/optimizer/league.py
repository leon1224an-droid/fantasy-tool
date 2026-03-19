"""
League-wide projections: team totals, H2H matchup comparison, and rankings.
"""

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date as date_type

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import GameDay, Player, PlayerProjection, YahooLeagueTeam
from .daily import DailyPlayer, optimize_daily_lineup
from ..ingestion.schedule import expand_team_set, normalize_team_abbr

CATEGORIES = ["pts", "reb", "ast", "stl", "blk", "tov", "tpm", "fg_pct", "ft_pct"]
LOWER_IS_BETTER = {"tov"}


@dataclass
class TeamProjection:
    team_key: str
    team_name: str
    week_num: int
    totals: dict[str, float] = field(default_factory=dict)
    total_games: int = 0


@dataclass
class CategoryResult:
    category: str
    a_value: float
    b_value: float
    winner: str      # "a" | "b" | "tie"
    margin: float


@dataclass
class MatchupResult:
    team_a: str
    team_b: str
    week_num: int
    categories: list[CategoryResult] = field(default_factory=list)
    a_wins: int = 0
    b_wins: int = 0
    ties: int = 0
    a_games: int = 0
    b_games: int = 0


# ---------------------------------------------------------------------------
# Team projection computation
# ---------------------------------------------------------------------------

async def compute_team_projections(
    db: AsyncSession,
    week_num: int,
    user_id: int,
    exclude: dict[str, set[str]] | None = None,
    max_players: int = 13,
) -> list[TeamProjection]:
    """
    For each Yahoo league team (belonging to user_id), compute projected stat
    totals for the week.

    Per-game stats  → bball_monster source only (the curated projection CSV).
    Games per week  → GameDay table + daily greedy optimizer (10-slot constraint),
                      identical to how the calendar/grid tabs count starts.
                      Every rostered player participates in the optimizer regardless
                      of whether they have a bball_monster projection row; players
                      without BM stats occupy slots but contribute 0 to totals.

    - Players in `exclude[team_key]` are treated as IL and skipped.
    - After exclusions, only the top `max_players` contribute (sorted by BM
      projected_total where available, otherwise 0).
    - FG%/FT% are weighted averages using fg_att_pg/ft_att_pg as weights.
    - Player position/team data comes from the JSONB roster stored in
      YahooLeagueTeam, supplemented by the user's Player records.
    """
    teams = (
        await db.execute(
            select(YahooLeagueTeam).where(YahooLeagueTeam.user_id == user_id)
        )
    ).scalars().all()
    if not teams:
        return []

    # --- bball_monster per-game stats scoped to this user's players ----------
    bm_rows = (
        await db.execute(
            select(Player, PlayerProjection)
            .join(PlayerProjection, Player.id == PlayerProjection.player_id)
            .where(
                Player.user_id == user_id,
                PlayerProjection.week_num == week_num,
                PlayerProjection.source == "bball_monster",
            )
        )
    ).all()
    bm_lookup: dict[str, PlayerProjection] = {p.name: proj for p, proj in bm_rows}

    # --- Build player info from JSONB roster data + user's Player records ----
    # Primary source: JSONB (covers all league players regardless of user roster)
    # Fallback: user's Player table rows for positions if JSONB is incomplete
    all_roster_names: set[str] = set()
    for team in teams:
        for entry in (team.roster or []):
            pname = entry.get("name") if isinstance(entry, dict) else getattr(entry, "name", None)
            if pname:
                all_roster_names.add(pname)

    user_player_rows = (
        await db.execute(
            select(Player).where(
                Player.user_id == user_id,
                Player.name.in_(list(all_roster_names)),
            )
        )
    ).scalars().all()
    player_record: dict[str, Player] = {p.name: p for p in user_player_rows}

    # Build a lightweight player-info dict from JSONB (positions + team)
    # so we can run the daily optimizer for all league players, not just the
    # user's own roster.
    jsonb_player_info: dict[str, dict] = {}
    for team in teams:
        for entry in (team.roster or []):
            if not isinstance(entry, dict):
                continue
            pname = entry.get("name", "")
            if pname and pname not in jsonb_player_info:
                jsonb_player_info[pname] = {
                    "team":      entry.get("team", ""),
                    "positions": entry.get("positions", ["SF", "PF"]),
                }

    # --- GameDay schedule for the week (games source) ------------------------
    gd_rows = (
        await db.execute(select(GameDay).where(GameDay.week_num == week_num))
    ).scalars().all()

    team_game_dates: dict[str, set[date_type]] = defaultdict(set)
    for gd in gd_rows:
        team_game_dates[normalize_team_abbr(gd.team)].add(gd.game_date)

    all_dates: list[date_type] = sorted({gd.game_date for gd in gd_rows})
    known_teams: set[str] = set(team_game_dates.keys())

    results: list[TeamProjection] = []

    for team in teams:
        team_exclude: set[str] = (exclude or {}).get(team.team_key, set())

        # Collect all roster players who are active (not on Yahoo IL) and not manually excluded
        # Use jsonb_player_info as the source of truth for who's in the league
        eligible_names: list[str] = []
        for entry in (team.roster or []):
            pname = entry.get("name") if isinstance(entry, dict) else getattr(entry, "name", None)
            if not pname or pname in team_exclude or pname not in jsonb_player_info:
                continue
            # Skip players Yahoo has placed on IL/IL+/NA slot
            if entry.get("is_il", False):
                continue
            eligible_names.append(pname)

        # Sort: BM players first (by BM projected value), unknown players last
        eligible_names.sort(
            key=lambda n: bm_lookup[n].fantasy_ppg * bm_lookup[n].games_count
                          if n in bm_lookup else 0.0,
            reverse=True,
        )
        active_names: set[str] = set(eligible_names[:max_players])

        # Warn about team abbreviation mismatches
        for name in active_names:
            info = jsonb_player_info.get(name) or {}
            nba_team = normalize_team_abbr(info.get("team") or "")
            if nba_team and nba_team not in known_teams:
                print(f"[league] WARNING: {name} team='{info.get('team')}' (→'{nba_team}') not in GameDay wk{week_num}. Known: {sorted(known_teams)}")

        # --- Daily optimizer: uses ALL active players for correct slot filling -
        starts_count: dict[str, int] = {name: 0 for name in active_names}
        for game_date in all_dates:
            players_today: list[DailyPlayer] = []
            for name in active_names:
                info = jsonb_player_info.get(name) or {}
                p_team = normalize_team_abbr(info.get("team") or "")
                p_positions = info.get("positions") or ["SF", "PF"]
                if game_date in team_game_dates.get(p_team, set()):
                    players_today.append(DailyPlayer(
                        name=name,
                        positions=p_positions,
                        # Use BM ppg for tie-breaking; 0 if not in BM
                        fantasy_ppg=bm_lookup[name].fantasy_ppg if name in bm_lookup else 0.0,
                    ))
            if players_today:
                daily_result = optimize_daily_lineup(players_today)
                for slot_player in daily_result.lineup.values():
                    if slot_player and slot_player in starts_count:
                        starts_count[slot_player] += 1

        # --- Stats: BM per-game rates × actual starts ------------------------
        acc: dict[str, float] = {
            "pts": 0.0, "reb": 0.0, "ast": 0.0, "stl": 0.0, "blk": 0.0,
            "tov": 0.0, "tpm": 0.0,
            "_fg_made": 0.0, "_fg_att": 0.0,
            "_ft_made": 0.0, "_ft_att": 0.0,
        }
        for name in active_names:
            g = starts_count.get(name, 0)
            proj = bm_lookup.get(name)
            if not proj or g == 0:
                continue
            acc["pts"]  += proj.pts_pg * g
            acc["reb"]  += proj.reb_pg * g
            acc["ast"]  += proj.ast_pg * g
            acc["stl"]  += proj.stl_pg * g
            acc["blk"]  += proj.blk_pg * g
            acc["tov"]  += proj.tov_pg * g
            acc["tpm"]  += proj.tpm_pg * g
            fg_att = proj.fg_att_pg * g
            ft_att = proj.ft_att_pg * g
            acc["_fg_made"] += proj.fg_pct * fg_att
            acc["_fg_att"]  += fg_att
            acc["_ft_made"] += proj.ft_pct * ft_att
            acc["_ft_att"]  += ft_att

        totals = {k: round(v, 2) for k, v in acc.items() if not k.startswith("_")}
        totals["fg_pct"] = round(
            acc["_fg_made"] / acc["_fg_att"] if acc["_fg_att"] > 0 else 0.0, 4
        )
        totals["ft_pct"] = round(
            acc["_ft_made"] / acc["_ft_att"] if acc["_ft_att"] > 0 else 0.0, 4
        )

        results.append(TeamProjection(
            team_key=team.team_key,
            team_name=team.team_name,
            week_num=week_num,
            totals=totals,
            total_games=sum(starts_count.values()),
        ))

    return results


# ---------------------------------------------------------------------------
# Head-to-head matchup
# ---------------------------------------------------------------------------

def project_matchup(a: TeamProjection, b: TeamProjection) -> MatchupResult:
    """Compare two teams category by category."""
    result = MatchupResult(team_a=a.team_name, team_b=b.team_name, week_num=a.week_num, a_games=a.total_games, b_games=b.total_games)

    for cat in CATEGORIES:
        a_val = a.totals.get(cat, 0.0)
        b_val = b.totals.get(cat, 0.0)

        if cat in LOWER_IS_BETTER:
            if a_val < b_val:
                winner = "a"
            elif b_val < a_val:
                winner = "b"
            else:
                winner = "tie"
        else:
            if a_val > b_val:
                winner = "a"
            elif b_val > a_val:
                winner = "b"
            else:
                winner = "tie"

        result.categories.append(CategoryResult(
            category=cat,
            a_value=round(a_val, 3),
            b_value=round(b_val, 3),
            winner=winner,
            margin=round(abs(a_val - b_val), 3),
        ))

        if winner == "a":
            result.a_wins += 1
        elif winner == "b":
            result.b_wins += 1
        else:
            result.ties += 1

    return result


# ---------------------------------------------------------------------------
# League rankings
# ---------------------------------------------------------------------------

async def compute_league_rankings(db: AsyncSession, week_num: int, user_id: int) -> list[dict]:
    """
    Simulate every team vs every other team and rank by total category wins.
    Returns list sorted by proj_wins descending.
    """
    projections = await compute_team_projections(db, week_num, user_id=user_id)
    if not projections:
        return []

    wins: dict[str, int] = {p.team_key: 0 for p in projections}

    for i, a in enumerate(projections):
        for b in projections[i + 1:]:
            matchup = project_matchup(a, b)
            wins[a.team_key] += matchup.a_wins
            wins[b.team_key] += matchup.b_wins

    sorted_teams = sorted(projections, key=lambda p: wins[p.team_key], reverse=True)

    return [
        {
            "rank": idx + 1,
            "team_key": p.team_key,
            "team_name": p.team_name,
            "proj_wins": wins[p.team_key],
            "total_games": p.total_games,
            **{k: v for k, v in p.totals.items()},
        }
        for idx, p in enumerate(sorted_teams)
    ]
