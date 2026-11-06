package session

import "fmt"

// LiveSessions returns a "name (id)" label for each session that would be
// terminated by an agentd shutdown (creating or running state).
func LiveSessions(sessions []*Session) []string {
	var labels []string
	for _, s := range sessions {
		if s == nil || (s.State != StateRunning && s.State != StateCreating) {
			continue
		}
		if s.Name != "" {
			labels = append(labels, fmt.Sprintf("%s (%s)", s.Name, s.ID))
		} else {
			labels = append(labels, s.ID)
		}
	}
	return labels
}
