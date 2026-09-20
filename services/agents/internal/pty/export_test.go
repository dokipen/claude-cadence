package pty

import "time"

// SetRepaintGapForTest overrides the gap between the repaint's two Setsize
// calls and returns a func that restores it.
func SetRepaintGapForTest(d time.Duration) func() {
	old := repaintGap
	repaintGap = d
	return func() { repaintGap = old }
}
