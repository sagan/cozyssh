package localpty

import (
	"io"
	"strings"
	"testing"
	"time"
)

func TestLocalSession_CloseKillsProcess(t *testing.T) {
	Load(nil)
	ls, err := Start("", false, "", nil)
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

// TestMarkerFilter_WithPTYEcho simulates Ubuntu/CentOS/OpenWrt where PTY echo
// is enabled: the marker appears first in the echoed command line, then again
// as the actual stdout of `echo marker`.  Neither occurrence should be visible.
func TestMarkerFilter_WithPTYEcho(t *testing.T) {
	marker := "__cozyssh_deadbeef__"
	simulated := "{ if ...; } 2>/dev/null; echo " + marker + "\r\n" +
		marker + "\r\n" +
		"root@linode:~# "

	r := newMarkerFilter(strings.NewReader(simulated), marker)
	out, err := io.ReadAll(r)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	result := string(out)
	if strings.Contains(result, marker) {
		t.Errorf("marker leaked through (echo-enabled case): %q", result)
	}
	if !strings.Contains(result, "root@linode:~# ") {
		t.Errorf("prompt was incorrectly discarded: %q", result)
	}
}

// TestMarkerFilter_WithoutPTYEcho simulates Alpine Linux where PTY echo is
// off: the marker appears only once (as the stdout of `echo marker`).
func TestMarkerFilter_WithoutPTYEcho(t *testing.T) {
	marker := "__cozyssh_deadbeef__"
	// No echoed command — only the echo output and the prompt.
	simulated := marker + "\r\n" +
		"root@alpine:~# "

	r := newMarkerFilter(strings.NewReader(simulated), marker)
	out, err := io.ReadAll(r)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	result := string(out)
	if strings.Contains(result, marker) {
		t.Errorf("marker leaked through (no-echo case): %q", result)
	}
	if !strings.Contains(result, "root@alpine:~# ") {
		t.Errorf("prompt was incorrectly discarded: %q", result)
	}
}

// TestMarkerFilter_SecondOccurrenceArrivesLate simulates the race where the
// filter finds the first marker in the echoed command but the second occurrence
// (actual echo output) arrives in a separate Read call — the common case on
// Ubuntu with bash where the shell takes a moment to evaluate the script.
func TestMarkerFilter_SecondOccurrenceArrivesLate(t *testing.T) {
	marker := "__cozyssh_deadbeef__"
	// Two separate chunks: first contains marker in echoed command only,
	// second contains the actual echo output + prompt.
	chunk1 := "{ ... }; echo " + marker + "\r\n"
	chunk2 := marker + "\r\nroot@linode:~# "

	r := newMarkerFilter(&twoChunkReader{
		first:  []byte(chunk1),
		second: []byte(chunk2),
	}, marker)
	out, err := io.ReadAll(r)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	result := string(out)
	if strings.Contains(result, marker) {
		t.Errorf("marker leaked through (late-second-occurrence case): %q", result)
	}
	if !strings.Contains(result, "root@linode:~# ") {
		t.Errorf("prompt was incorrectly discarded: %q", result)
	}
}

func TestMarkerFilter_FragmentedMarker(t *testing.T) {
	marker := "__cozyssh_deadbeef__"
	// Split the marker across two reads via slowReader
	simulated := "junk\r\n" + marker + "\r\nreal output\r\n"

	r := newMarkerFilter(&slowReader{data: []byte(simulated)}, marker)
	out, err := io.ReadAll(r)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	result := string(out)
	if strings.Contains(result, "junk") {
		t.Errorf("pre-marker content leaked through: %q", result)
	}
	if strings.Contains(result, marker) {
		t.Errorf("marker leaked through: %q", result)
	}
	if !strings.Contains(result, "real output") {
		t.Errorf("post-marker output was incorrectly discarded: %q", result)
	}
}

func TestMarkerFilter_StreamEndBeforeMarker(t *testing.T) {
	// If the stream ends without a marker, the filter should unblock (not hang).
	r := newMarkerFilter(strings.NewReader("some output without marker"), "__cozyssh_xyz__")
	_, err := io.ReadAll(r)
	// Should not block forever — just get EOF
	if err != nil && err != io.EOF {
		t.Errorf("unexpected error: %v", err)
	}
}

// twoChunkReader returns first then second on successive Read calls.
type twoChunkReader struct {
	first, second []byte
	step          int
}

func (r *twoChunkReader) Read(p []byte) (int, error) {
	switch r.step {
	case 0:
		r.step++
		n := copy(p, r.first)
		return n, nil
	case 1:
		r.step++
		n := copy(p, r.second)
		return n, io.EOF
	default:
		return 0, io.EOF
	}
}

// slowReader returns one byte at a time to test fragmented read handling.
type slowReader struct {
	data []byte
	pos  int
}

func (r *slowReader) Read(p []byte) (int, error) {
	if r.pos >= len(r.data) {
		return 0, io.EOF
	}
	p[0] = r.data[r.pos]
	r.pos++
	if r.pos >= len(r.data) {
		return 1, io.EOF
	}
	return 1, nil
}
