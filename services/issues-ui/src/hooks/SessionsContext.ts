import { createContext, useContext } from "react";
import type { Session } from "../types";

interface SessionsContextValue {
  optimisticSetDestroying: (sessionId: string) => void;
  optimisticAddSession: (session: Session, agentName: string) => void;
}

export const SessionsContext = createContext<SessionsContextValue>({
  optimisticSetDestroying: () => {},
  optimisticAddSession: () => {},
});

export function useSessionsContext() {
  return useContext(SessionsContext);
}
