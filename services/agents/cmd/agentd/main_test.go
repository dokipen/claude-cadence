package main

import (
	"net"
	"testing"
)

func TestBindTerminalListener_Empty(t *testing.T) {
	ln, adv := bindTerminalListener("")
	if ln != nil || adv != "" {
		t.Fatalf("got (%v, %q), want (nil, \"\")", ln, adv)
	}
}

func TestBindTerminalListener_Success(t *testing.T) {
	ln, adv := bindTerminalListener("127.0.0.1:0")
	if ln == nil {
		t.Fatal("expected listener")
	}
	defer ln.Close()
	if adv != "127.0.0.1:0" {
		t.Errorf("advertise = %q", adv)
	}
}

// A bind failure must fall back to relay mode: no listener, empty advertise.
func TestBindTerminalListener_BindFailureFallsBackToRelay(t *testing.T) {
	busy, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer busy.Close()
	ln, adv := bindTerminalListener(busy.Addr().String())
	if ln != nil {
		ln.Close()
		t.Fatal("expected nil listener on bind failure")
	}
	if adv != "" {
		t.Errorf("advertise = %q, want empty (relay)", adv)
	}
}

func TestBindTerminalListener_UnassignedAddress(t *testing.T) {
	// 192.0.2.0/24 (TEST-NET-1) is never locally assigned.
	ln, adv := bindTerminalListener("192.0.2.1:8001")
	if ln != nil || adv != "" {
		t.Fatalf("got (%v, %q), want relay fallback", ln, adv)
	}
}
