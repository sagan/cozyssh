package localpty

import (
	"testing"
	"time"
)

func TestLocalSession_CloseKillsProcess(t *testing.T) {
	Load(nil)
	ls, err := Start("", false)
	if err != nil {
		t.Fatalf("failed to start local session: %v", err)
	}

	// Verify the process is running
	if ls.cmd.Process == nil {
		t.Fatalf("expected cmd.Process to be non-nil")
	}

	// Close the session
	err = ls.Close()
	if err != nil {
		t.Fatalf("failed to close local session: %v", err)
	}

	// Wait a bit to let the process exit and Wait to return
	done := make(chan struct{})
	go func() {
		// Wait for the process state to show it exited or process to be dead
		for {
			if ls.cmd.ProcessState != nil {
				close(done)
				return
			}
			time.Sleep(50 * time.Millisecond)
		}
	}()

	select {
	case <-done:
		// success
	case <-time.After(5 * time.Second):
		t.Fatalf("process did not exit within timeout after Close()")
	}
}
