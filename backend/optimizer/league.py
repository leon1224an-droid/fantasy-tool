"""
League-wide projections: team totals, H2H matchup comparison, and rankings.
"""

from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..ingestion.source import get_active_source
from ..models import Player, PlayerProjection, YahooLeagueTeam

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

    - Players in `exclude[team_key]` are treated as IL and skipped.
    - After exclusions, only the top `max_players` (by projected_total) contribute.
    - FG%/FT% are computed as weighted averages using fg_att_pg/ft_att_pg as weights.
    """
    active_source = await get_active_source(db)

    teams = (await db.execute(select(YahooLeagueTeam))).scalars().all()
    if not teams:
        return []

    proj_rows = (
        await db.execute(
            select(Player, PlayerProjection)
            .join(PlayerProjection, Player.id == PlayerProjection.player_id)
            .where(
                PlayerProjection.week_num == week_num,
                PlayerProjection.source == active_source,
            )
        )
    ).all()

    proj_lookup: dict[str, PlayerProjection] = {
        player.name: proj for player, proj in proj_rows
    }

    results: list[TeamProjection] = []

    for team in teams:
        team_exclude: set[str] = (exclude or {}).get(team.team_key, set())

        # Collect eligible players (have a projection, not on IL)
        eligible: list[PlayerProjection] = []
        for entry in (team.roster or []):
            pname = entry.get("name") if isinstance(entry, dict) else getattr(entry, "name", None)
            if not pname or pname in team_exclude:
                continue
            proj = proj_lookup.get(pname)
            if proj:
                eligible.append(proj)

        # Sort by projected value descending, cap at max_players
        eligible.sort(key=lambda p: p.fantasy_ppg * p.games_count, reverse=True)
        active = eligible[:max_players]

        acc: dict[str, float] = {
            "pts": 0.0, "reb": 0.0, "ast": 0.0, "stl": 0.0, "blk": 0.0,
            "tov": 0.0, "tpm": 0.0,
            "_fg_made": 0.0, "_fg_att": 0.0,
            "_ft_made": 0.0, "_ft_att": 0.0,
        }

        for proj in active:
            g = proj.games_count
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

        total_games = sum(p.games_count for p in active)

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
            **{k: v for k, v in p.totals.items()},
        }
        for idx, p in enumerate(sorted_teams)
    ]
