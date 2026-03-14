import React, { createContext, useContext, useState } from "react";
import { LeagueTeamResponse } from "./api";

interface ActiveTeamCtx {
  activeTeam: LeagueTeamResponse | null;
  setActiveTeam: (team: LeagueTeamResponse | null) => void;
}

const ActiveTeamContext = createContext<ActiveTeamCtx>({
  activeTeam: null,
  setActiveTeam: () => {},
});

export function ActiveTeamProvider({ children }: { children: React.ReactNode }) {
  const [activeTeam, setActiveTeam] = useState<LeagueTeamResponse | null>(null);
  return (
    <ActiveTeamContext.Provider value={{ activeTeam, setActiveTeam }}>
      {children}
    </ActiveTeamContext.Provider>
  );
}

export function useActiveTeam() {
  return useContext(ActiveTeamContext);
}
