# Fantasy Basketball Playoff Optimizer — Project Context

## Project Structure
```
fantasy-tool/
├── backend/
│   ├── ingestion/      # Data ingestion from NBA APIs / sources
│   ├── optimizer/      # Lineup optimization logic
│   ├── metrics/        # Stat calculations and scoring
│   └── projections/    # Player projection models
├── data/               # Raw and processed data files
├── mobile/             # (ignored for now)
├── database.py         # PostgreSQL connection and session management
├── requirements.txt
└── CLAUDE.md
```

## Tech Stack
- **Backend**: Python, FastAPI
- **Database**: PostgreSQL (default port 5432)
- **ORM**: SQLAlchemy (async)

## Roster (13 players)
| Player | Team | Positions |
|---|---|---|
| James Harden | CLE | PG/SG |
| Kevin Durant | HOU | SG/SF/PF |
| Noah Clowney | BKN | PF/C |
| Nickeil Alexander-Walker | ATL | PG/SG/SF |
| De'Aaron Fox | SAS | PG/SG |
| Darius Garland | LAC | PG |
| Jalen Suggs | ORL | PG/SG |
| Christian Braun | DEN | SG/SF |
| Immanuel Quickley | TOR | PG/SG |
| Nique Clifford | SAC | SG/SF |
| Austin Reaves | LAL | PG/SG/SF |
| Cooper Flagg | DAL | PG/SG/SF |
| Toumani Camara | POR | SF/PF/C |

## League Settings
### Starting Slots (10 starters + 3 bench = 13 total)
| Slot | Count |
|---|---|
| PG | 1 |
| SG | 1 |
| G (PG or SG) | 1 |
| SF | 1 |
| PF | 1 |
| F (SF or PF) | 1 |
| C | 2 |
| UTIL (any position) | 2 |
| Bench | 3 |

### Position Eligibility Rules
- G slot: PG or SG eligible
- F slot: SF or PF eligible
- C slot: C eligible only
- UTIL slot: any position eligible

## Playoff Schedule
| Week | Dates |
|---|---|
| Week 21 | Mar 16 – Mar 22, 2026 |
| Week 22 | Mar 23 – Mar 29, 2026 |
| Week 23 | Mar 30 – Apr 5, 2026 |

## Database
- **Engine**: PostgreSQL
- **Port**: 5432
- **Connection**: managed via `database.py` using SQLAlchemy async engine
- **DSN env var**: `DATABASE_URL` (falls back to `postgresql+asyncpg://postgres:postgres@localhost:5432/fantasy_tool`)

## Key Concepts
- Optimize starting lineup each week to maximize fantasy scoring across the 3-week playoff
- Account for games-played schedules (some teams play 3–4 games/week, some 2)
- Track per-game projections and multiply by games played for weekly totals
- Bench slots do not score — only the 10 starters contribute each week
