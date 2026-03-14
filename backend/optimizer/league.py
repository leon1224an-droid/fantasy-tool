"""
League-wide projections: team totals, H2H matchup comparison, and rankings.
"""

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date as date_type

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..ingestion.source import get_active_source
from ..models import GameDay, Player, PlayerProjection, YahooLeagueTeam
from .daily import DailyPlayer, optimize_daily_lineup

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
    exclude: dict[str, set[str]] | None = None,
    max_players: int = 13,
) -> list[TeamProjection]:
    """
    For each Yahoo league team, sum projected stat totals for the week
    using the active projection source.

    Games are counted using the same daily greedy optimizer as the calendar page:
    each day we run optimize_daily_lineup for the players with games that day,
    and only slotted players (≤10) count toward totals. This matches the calendar.

    - Players in `exclude[team_key]` are treated as IL and skipped.
    - After exclusions, only the top `max_players` (by projected_total) contribute.
    - FG%/FT% are computed as weighted averages using fg_att_pg/ft_att_pg as weights.
    """
    active_source = await get_active_source(db)

    teams = (await db.execute(select(YahooLeagueTeam))).scalars().all()
    if not teams:
        return []

    # Fetch projections for ALL sources so players missing from the active source
    # (e.g. not in the uploaded BM CSV) still count via fallback.
    all_proj_rows = (
        await db.execute(
            select(Player, PlayerProjection)
            .join(PlayerProjection, Player.id == PlayerProjection.player_id)
            .where(PlayerProjection.week_num == week_num)
        )
    ).all()

    # Prefer active source; fall back to any other available source per player.
    proj_lookup: dict[str, PlayerProjection] = {}
    player_team_lookup: dict[str, str] = {}
    player_pos_lookup: dict[str, list[str]] = {}
    for player, proj in all_proj_rows:
        if player.name not in proj_lookup or proj.source == active_source:
            proj_lookup[player.name] = proj
        player_team_lookup[player.name] = player.team
        player_pos_lookup[player.name] = player.positions

    # Load every game day for this week so we can run the daily optimizer
    gd_rows = (
        await db.execute(select(GameDay).where(GameDay.week_num == week_num))
    ).scalars().all()

    # {nba_team: set[game_date]}
    team_game_dates: dict[str, set[date_type]] = defaultdict(set)
    for gd in gd_rows:
        team_game_dates[gd.team].add(gd.game_date)

    all_dates: list[date_type] = sorted({gd.game_date for gd in gd_rows})
    known_teams: set[str] = set(team_game_dates.keys())

    results: list[TeamProjection] = []

    for team in teams:
        team_exclude: set[str] = (exclude or {}).get(team.team_key, set())

        # Collect eligible players (have a projection, not excluded)
        eligible: list[tuple[str, PlayerProjection]] = []
        for entry in (team.roster or []):
            pname = entry.get("name") if isinstance(entry, dict) else getattr(entry, "name", None)
            if not pname or pname in team_exclude:
                continue
            proj = proj_lookup.get(pname)
            if proj:
                eligible.append((pname, proj))

        # Sort by projected value descending, cap at max_players
        eligible.sort(key=lambda x: x[1].fantasy_ppg * x[1].games_count, reverse=True)
        active_list = eligible[:max_players]
        active_proj: dict[str, PlayerProjection] = {name: proj for name, proj in active_list}

        # Warn about players whose NBA team abbreviation has no GameDay rows
        for name in active_proj:
            nba_team = player_team_lookup.get(name)
            if nba_team and nba_team not in known_teams:
                print(f"[league] WARNING: {name} team='{nba_team}' not found in GameDay (wk{week_num}). Known: {sorted(known_teams)}")

        # Run daily optimizer for each game day — counts only slotted starts (≤10)
        starts_count: dict[str, int] = {name: 0 for name in active_proj}
        for game_date in all_dates:
            players_today: list[DailyPlayer] = []
            for name, proj in active_proj.items():
                nba_team = player_team_lookup.get(name)
                if nba_team and game_date in team_game_dates.get(nba_team, set()):
                    players_today.append(DailyPlayer(
                        name=name,
                        positions=player_pos_lookup.get(name, []),
                        fantasy_ppg=proj.fantasy_ppg,
                    ))
            if players_today:
                daily_result = optimize_daily_lineup(players_today)
                for slot_player in daily_result.lineup.values():
                    if slot_player and slot_player in starts_count:
                        starts_count[slot_player] += 1

        acc: dict[str, float] = {
            "pts": 0.0, "reb": 0.0, "ast": 0.0, "stl": 0.0, "blk": 0.0,
            "tov": 0.0, "tpm": 0.0,
            "_fg_made": 0.0, "_fg_att": 0.0,
            "_ft_made": 0.0, "_ft_att": 0.0,
        }

        for name, proj in active_proj.items():
            g = starts_count.get(name, 0)
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

        total_games = sum(starts_count.values())

        results.append(TeamProjection(
            team_key=team.team_key,
            team_name=team.team_name,
            week_num=week_num,
            totals=totals,
            total_games=total_games,
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

async def compute_league_rankings(db: AsyncSession, week_num: int) -> list[dict]:
    """
    Simulate every team vs every other team and rank by total category wins.
    Returns list sorted by proj_wins descending.
    """
    projections = await compute_team_projections(db, week_num)
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
