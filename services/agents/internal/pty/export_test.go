package pty

import "time"

// SetRepaintGapForTest overrides the gap between the repaint's two Setsize
// calls and returns a func that restores it.
func SetRepaintGapForTest(d time.Duration) func() {
	old := repaintGap
	repaintGap = d
	return func() { repaintGap = old }
}

// SetRepaintResizeWaitForTest overrides how long the repaint waits for the
// client's initial resize. Returns a restore func.
func SetRepaintResizeWaitForTest(d time.Duration) func() {
	old := repaintResizeWait
	repaintResizeWait = d
	return func() { repaintResizeWait = old }
}
