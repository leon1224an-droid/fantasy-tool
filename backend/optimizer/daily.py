"""
Greedy daily lineup optimizer — ported from the Google Sheets Apps Script.

Unlike the weekly ILP (which maximises projected fantasy points), this optimizer
answers the simpler question: "Given which players have games TODAY, how many
can we fit into the 10 starting slots given position constraints, and who gets
benched?"

Priority order mirrors the Sheets tool:
  1. C  (most restrictive — only C-eligible players)
  2. PG (exact)
  3. SG (exact)
  4. SF / PF / F together (smart forward filling)
  5. G  (PG or SG)
  6. UTIL1, UTIL2 (anyone remaining)
"""

from dataclasses import dataclass, field

# Ordered display slots
SLOTS = ["PG", "SG", "G", "SF", "PF", "F", "C1", "C2", "UTIL1", "UTIL2"]


@dataclass
class DailyPlayer:
    name: str
    positions: list[str]  # uppercase, e.g. ["PG", "SG"]
    fantasy_ppg: float = 0.0  # used to break ties (higher = preferred)


@dataclass
class DailyLineupResult:
    lineup: dict[str, str | None] = field(default_factory=dict)   # slot -> player name
    benched: list[str] = field(default_factory=list)
    total_playing: int = 0
    total_available: int = 0


def _prefer_least_flexible(players: list[DailyPlayer], *, desc_ppg: bool = False) -> list[DailyPlayer]:
    """Sort: fewest positions first (least flexible fills restrictive slots first).
    Break ties by fantasy_ppg descending."""
    return sorted(players, key=lambda p: (len(p.positions), -p.fantasy_ppg if desc_ppg else 0))


def optimize_daily_lineup(players: list[DailyPlayer]) -> DailyLineupResult:
    """
    Assign players to 10 starting slots using a greedy algorithm.
    Returns the lineup dict, list of benched players, and counts.
    """
    lineup: dict[str, str | None] = {slot: None for slot in SLOTS}
    assigned: set[str] = set()

    def available(pos_filter=None) -> list[DailyPlayer]:
        pool = [p for p in players if p.name not in assigned]
        if pos_filter is None:
            return pool
        return [p for p in pool if pos_filter(p)]

    # ── Step 1: C slots (most restrictive) ──────────────────────────────────
    c_eligible = _prefer_least_flexible(available(lambda p: "C" in p.positions))
    for i, player in enumerate(c_eligible[:2]):
        lineup[f"C{i + 1}"] = player.name
        assigned.add(player.name)

    # ── Step 2: PG (exact) ──────────────────────────────────────────────────
    pg_pool = _prefer_least_flexible(available(lambda p: "PG" in p.positions))
    if pg_pool:
        lineup["PG"] = pg_pool[0].name
        assigned.add(pg_pool[0].name)

    # ── Step 3: SG (exact) ──────────────────────────────────────────────────
    sg_pool = _prefer_least_flexible(available(lambda p: "SG" in p.positions))
    if sg_pool:
        lineup["SG"] = sg_pool[0].name
        assigned.add(sg_pool[0].name)

    # ── Step 4: Smart forward filling ───────────────────────────────────────
    _fill_forward_slots(players, lineup, assigned)

    # ── Step 5: G slot (PG or SG) ───────────────────────────────────────────
    g_pool = _prefer_least_flexible(
        available(lambda p: "PG" in p.positions or "SG" in p.positions)
    )
    if g_pool:
        lineup["G"] = g_pool[0].name
        assigned.add(g_pool[0].name)

    # ── Step 6: UTIL slots (anyone) ─────────────────────────────────────────
    for i in range(1, 3):
        util_pool = _prefer_least_flexible(available())
        if util_pool:
            lineup[f"UTIL{i}"] = util_pool[0].name
            assigned.add(util_pool[0].name)

    benched = [p.name for p in players if p.name not in assigned]

    return DailyLineupResult(
        lineup=lineup,
        benched=benched,
        total_playing=len(assigned),
        total_available=len(players),
    )


def _fill_forward_slots(
    players: list[DailyPlayer],
    lineup: dict[str, str | None],
    assigned: set[str],
) -> None:
    """
    Smart filling of SF (1), PF (1), F (1) slots.
    Mirrors the Sheets fillForwardSlots() logic:
      - PF slot: prefer pure PF, then SF/PF dual
      - SF slot: prefer pure SF, then SF/SG wing, then SF/PF dual
      - F  slot: any remaining forward
    """
    def fwd_available() -> list[DailyPlayer]:
        return [
            p for p in players
            if p.name not in assigned and ("SF" in p.positions or "PF" in p.positions)
        ]

    # PF slot
    pf_pool = [p for p in fwd_available() if "PF" in p.positions]
    pf_pool.sort(key=lambda p: (
        0 if "SF" not in p.positions else 1,  # pure PF first
        len(p.positions),
        -p.fantasy_ppg,
    ))
    if pf_pool:
        lineup["PF"] = pf_pool[0].name
        assigned.add(pf_pool[0].name)

    # SF slot
    sf_pool = [p for p in fwd_available() if "SF" in p.positions]
    sf_pool.sort(key=lambda p: (
        0 if ("SF" in p.positions and "PF" not in p.positions and "SG" not in p.positions) else
        1 if "SG" in p.positions else 2,       # pure SF > wing > dual SF/PF
        len(p.positions),
        -p.fantasy_ppg,
    ))
    if sf_pool:
        lineup["SF"] = sf_pool[0].name
        assigned.add(sf_pool[0].name)

    # F slot — any remaining forward
    f_pool = sorted(fwd_available(), key=lambda p: (len(p.positions), -p.fantasy_ppg))
    if f_pool:
        lineup["F"] = f_pool[0].name
        assigned.add(f_pool[0].name)
