import { createContext, useContext } from "react";

interface SessionsContextValue {
  optimisticSetDestroying: (sessionId: string) => void;
}

export const SessionsContext = createContext<SessionsContextValue>({
  optimisticSetDestroying: () => {},
});

export function useSessionsContext() {
  return useContext(SessionsContext);
}
