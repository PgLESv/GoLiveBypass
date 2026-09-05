package vpn

import (
	"context"
	"sync/atomic"
	"testing"
	"time"

	"protonvpn-wg-confgen/internal/api"
)

func TestProbeCandidatesDeduplicatesPhysicalIPs(t *testing.T) {
	a := server("US", api.TierFree, 0)
	a.Servers[0].EntryIP = "192.0.2.1"
	b := a
	b.Name = "US#2"
	var calls atomic.Int32
	result := probeCandidates(context.Background(), []api.LogicalServer{a, b}, func(context.Context, string) int {
		calls.Add(1)
		return 42
	})
	if calls.Load() != 1 || result[a.Name] != 42 || result[b.Name] != 42 {
		t.Fatalf("calls=%d results=%v", calls.Load(), result)
	}
}

func TestProbeCandidatesRespectsCancellation(t *testing.T) {
	a := server("US", api.TierFree, 0)
	a.Servers[0].EntryIP = "192.0.2.1"
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	result := probeCandidates(ctx, []api.LogicalServer{a}, func(context.Context, string) int {
		t.Error("canceled scan must not probe")
		return 42
	})
	if len(result) != 0 {
		t.Fatalf("unexpected measurements: %v", result)
	}
}

func TestProbeCandidatesCancelsInFlightProbe(t *testing.T) {
	a := server("US", api.TierFree, 0)
	a.Servers[0].EntryIP = "192.0.2.1"
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan map[string]int, 1)
	started := make(chan struct{})
	go func() {
		done <- probeCandidates(ctx, []api.LogicalServer{a}, func(ctx context.Context, _ string) int {
			close(started)
			<-ctx.Done()
			return 999
		})
	}()
	<-started
	cancel()
	select {
	case result := <-done:
		if result[a.Name] != 999 {
			t.Fatalf("canceled measurement is not failure: %v", result)
		}
	case <-time.After(time.Second):
		t.Fatal("scan did not stop")
	}
}
