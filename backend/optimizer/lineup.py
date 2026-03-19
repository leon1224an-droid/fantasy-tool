"""
ILP-based weekly lineup optimizer using PuLP.

Problem: assign 13 roster players to 10 starting slots + 3 bench slots to
maximise total projected fantasy points for a given week.  Only starters score.

Slot eligibility
----------------
Slot   Eligible positions
-----  -------------------
PG     PG
SG     SG
G      PG, SG
SF     SF
PF     PF
F      SF, PF
C1     C
C2     C
UTIL1  PG, SG, SF, PF, C
UTIL2  PG, SG, SF, PF, C
"""

from dataclasses import dataclass, field

from pulp import (
    PULP_CBC_CMD,
    LpBinary,
    LpMaximize,
    LpProblem,
    LpVariable,
    lpSum,
    value,
)
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

# ---------------------------------------------------------------------------
# Slot definitions
# ---------------------------------------------------------------------------
SLOTS: list[str] = ["PG", "SG", "G", "SF", "PF", "F", "C1", "C2", "UTIL1", "UTIL2"]

SLOT_ELIGIBLE: dict[str, set[str]] = {
    "PG":    {"PG"},
    "SG":    {"SG"},
    "G":     {"PG", "SG"},
    "SF":    {"SF"},
    "PF":    {"PF"},
    "F":     {"SF", "PF"},
    "C1":    {"C"},
    "C2":    {"C"},
    "UTIL1": {"PG", "SG", "SF", "PF", "C"},
    "UTIL2": {"PG", "SG", "SF", "PF", "C"},
}


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------
@dataclass
class PlayerInput:
    name: str
    positions: list[str]                # e.g. ["PG", "SG"]
    projected_total: float              # fantasy pts for the week (ppg × games)


@dataclass
class SlotAssignment:
    slot: str
    player: str
    projected_total: float


@dataclass
class LineupResult:
    week_num: int
    starters: list[SlotAssignment] = field(default_factory=list)
    bench: list[str] = field(default_factory=list)
    total_projected: float = 0.0

    def display(self) -> str:
        lines = [f"── Week {self.week_num} Optimal Lineup ──"]
        for s in self.starters:
            lines.append(f"  {s.slot:<6}  {s.player:<30}  {s.projected_total:.1f} pts")
        lines.append(f"  Bench:  {', '.join(self.bench)}")
        lines.append(f"  Total projected: {self.total_projected:.1f} pts")
        return "\n".join(lines)


# ---------------------------------------------------------------------------
# Core optimizer
# ---------------------------------------------------------------------------
def optimize_lineup(players: list[PlayerInput], week_num: int) -> LineupResult:
    """
    Solve the assignment ILP and return the optimal lineup for a single week.
    Raises ValueError if no feasible solution exists (e.g. not enough C-eligible players).
    """
    prob = LpProblem(f"fantasy_lineup_w{week_num}", LpMaximize)

    # Binary decision variables: x[player_name][slot]
    x: dict[str, dict[str, LpVariable]] = {}
    for p in players:
        safe = p.name.replace(" ", "_").replace("'", "")
        x[p.name] = {
            s: LpVariable(f"x_{safe}_{s}", cat=LpBinary)
            for s in SLOTS
        }

    # Objective ---------------------------------------------------------------
    prob += lpSum(
        x[p.name][s] * p.projected_total
        for p in players
        for s in SLOTS
    )

    # Constraint 1: each player fills at most one slot -------------------------
    for p in players:
        prob += lpSum(x[p.name][s] for s in SLOTS) <= 1, f"one_slot_{p.name}"

    # Constraint 2: each starting slot is filled by exactly one player --------
    for s in SLOTS:
        prob += lpSum(x[p.name][s] for p in players) == 1, f"fill_{s}"

    # Constraint 3: position eligibility --------------------------------------
    for p in players:
        player_pos = set(p.positions)
        for s in SLOTS:
            if not player_pos & SLOT_ELIGIBLE[s]:
                prob += x[p.name][s] == 0, f"ineligible_{p.name}_{s}"

    # Solve -------------------------------------------------------------------
    prob.solve(PULP_CBC_CMD(msg=0))

    if prob.status != 1:
        raise ValueError(
            f"Optimizer found no feasible solution for week {week_num}. "
            "Check that enough C-eligible players exist for both C slots."
        )

    # Parse solution ----------------------------------------------------------
    starters: list[SlotAssignment] = []
    starter_names: set[str] = set()

    for s in SLOTS:
        for p in players:
            if round(value(x[p.name][s]) or 0) == 1:
                starters.append(SlotAssignment(
                    slot=s,
                    player=p.name,
                    projected_total=p.projected_total,
                ))
                starter_names.add(p.name)
                break  # each slot has exactly one winner

    starters.sort(key=lambda a: SLOTS.index(a.slot))
    bench = [p.name for p in players if p.name not in starter_names]
    total = sum(a.projected_total for a in starters)

    return LineupResult(
        week_num=week_num,
        starters=starters,
        bench=bench,
        total_projected=round(total, 2),
    )


# ---------------------------------------------------------------------------
# DB-backed convenience wrapper
# ---------------------------------------------------------------------------
async def optimize_all_weeks(db: AsyncSession, user_id: int) -> list[LineupResult]:
    """
    Load Player + PlayerProjection rows from the DB (filtered by active source
    and user_id) and run the optimizer for each of the 3 playoff weeks.
    Returns one LineupResult per week.
    """
    from ..models import Player, PlayerProjection  # local import avoids circular
    from ..ingestion.source import get_active_source

    active_source = await get_active_source(db, user_id=user_id)
    results: list[LineupResult] = []

    for week_num in (21, 22, 23):
        rows = (
            await db.execute(
                select(Player, PlayerProjection)
                .join(PlayerProjection, Player.id == PlayerProjection.player_id)
                .where(
                    Player.user_id == user_id,
                    PlayerProjection.week_num == week_num,
                    PlayerProjection.source == active_source,
                    Player.is_active == True,
                    Player.is_il == False,
                )
            )
        ).all()

        if not rows:
            print(f"[optimizer] No projection data for week {week_num} (source={active_source}) — skipping.")
            continue

        players = [
            PlayerInput(
                name=player.name,
                positions=player.positions,
                projected_total=proj.projected_total,
            )
            for player, proj in rows
        ]

        result = optimize_lineup(players, week_num)
        results.append(result)
        try:
            print(result.display())
        except UnicodeEncodeError:
            print(result.display().encode("ascii", errors="replace").decode("ascii"))

    return results
