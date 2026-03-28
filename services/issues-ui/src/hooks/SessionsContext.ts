import { createContext, useContext } from "react";
import type { Session } from "../types";

interface SessionsContextValue {
  optimisticSetDestroying: (sessionId: string) => void;
  optimisticResetState: (sessionId: string, state: Session["state"]) => void;
  optimisticAddSession: (session: Session, agentName: string) => void;
}

export const SessionsContext = createContext<SessionsContextValue>({
  optimisticSetDestroying: () => {},
  optimisticResetState: () => {},
  optimisticAddSession: () => {},
});

export function useSessionsContext() {
  return useContext(SessionsContext);
}
