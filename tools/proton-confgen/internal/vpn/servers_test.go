package vpn

import (
	"fmt"
	"testing"

	"protonvpn-wg-confgen/internal/api"
	"protonvpn-wg-confgen/internal/config"
	"protonvpn-wg-confgen/internal/constants"
)

const (
	nlServer = "NL#1"
	chServer = "CH#1"
	usServer = "US#1"
)

// server builds an online logical server with one online physical server.
func server(country string, tier, features int) api.LogicalServer {
	return api.LogicalServer{
		Name:        country + "#1",
		ExitCountry: country,
		Tier:        tier,
		Features:    features,
		Status:      constants.StatusOnline,
		Servers:     []api.PhysicalServer{{Status: constants.StatusOnline}},
	}
}

func TestEligibleServers(t *testing.T) {
	var (
		plusP2P    = server("NL", api.TierPlus, api.FeatureP2P)
		plusPlain  = server("NL", api.TierPlus, 0)
		plusCore   = server("CH", api.TierPlus, api.FeatureSecureCore)
		freePlain  = server("US", api.TierFree, 0)
		offline    = api.LogicalServer{Name: "off", ExitCountry: "NL", Tier: api.TierPlus, Status: 0, Servers: []api.PhysicalServer{{}}}
		noPhysical = api.LogicalServer{Name: "empty", ExitCountry: "NL", Tier: api.TierPlus, Status: constants.StatusOnline}
	)
	all := []api.LogicalServer{plusP2P, plusPlain, plusCore, freePlain, offline, noPhysical}

	tests := []struct {
		name string
		cfg  config.Config
		want []string
	}{
		{
			// Offline and physical-server-less entries never survive, and free
			// tier is excluded unless asked for.
			name: "defaults exclude offline, empty and free",
			want: []string{nlServer, nlServer, chServer},
		},
		{
			name: "country filter",
			cfg:  config.Config{Countries: []string{"CH"}},
			want: []string{chServer},
		},
		{
			name: "empty country list matches everything",
			cfg:  config.Config{Countries: nil},
			want: []string{nlServer, nlServer, chServer},
		},
		{
			name: "free-only swaps the tier filter rather than widening it",
			cfg:  config.Config{FreeOnly: true},
			want: []string{usServer},
		},
		{
			name: "p2p-only",
			cfg:  config.Config{P2PServersOnly: true},
			want: []string{nlServer},
		},
		{
			// P2P is suppressed by secure-core and by free-only, otherwise those
			// combinations would filter each other down to nothing.
			name: "secure-core suppresses the p2p filter",
			cfg:  config.Config{P2PServersOnly: true, SecureCoreOnly: true},
			want: []string{chServer},
		},
		{
			name: "free-only suppresses the p2p filter",
			cfg:  config.Config{P2PServersOnly: true, FreeOnly: true},
			want: []string{usServer},
		},
		{
			name: "secure-core alone",
			cfg:  config.Config{SecureCoreOnly: true},
			want: []string{chServer},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := EligibleServers(&tt.cfg, all)
			names := make([]string, len(got))
			for i := range got {
				names[i] = got[i].Name
			}
			if len(names) != len(tt.want) {
				t.Fatalf("got %v, want %v", names, tt.want)
			}
			for i := range names {
				if names[i] != tt.want[i] {
					t.Fatalf("got %v, want %v", names, tt.want)
				}
			}
		})
	}
}

func TestGetBestPhysicalServer(t *testing.T) {
	online := api.PhysicalServer{ID: "on", Status: constants.StatusOnline}
	down := api.PhysicalServer{ID: "down", Status: 0}

	tests := []struct {
		name string
		in   []api.PhysicalServer
		want string // "" means nil
	}{
		{name: "picks the first online", in: []api.PhysicalServer{down, online}, want: "on"},
		{name: "no physical servers", in: nil},
		// An offline endpoint would yield a config pointing at a dead server.
		{name: "all offline yields nil", in: []api.PhysicalServer{down, down}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := GetBestPhysicalServer(&api.LogicalServer{Servers: tt.in})
			if tt.want == "" {
				if got != nil {
					t.Fatalf("got %+v, want nil", got)
				}
				return
			}
			if got == nil || got.ID != tt.want {
				t.Fatalf("got %+v, want ID %q", got, tt.want)
			}
		})
	}
}

func TestSelectBestWithPing(t *testing.T) {
	srv1 := api.LogicalServer{
		Name:        "US-EAST#1",
		ExitCountry: "US",
		Tier:        api.TierFree,
		Status:      constants.StatusOnline,
		Load:        20,
		Score:       1.5,
		Servers:     []api.PhysicalServer{{Status: constants.StatusOnline, EntryIP: "127.0.0.1"}},
	}
	srv2 := api.LogicalServer{
		Name:        "NL#1",
		ExitCountry: "NL",
		Tier:        api.TierFree,
		Status:      constants.StatusOnline,
		Load:        50,
		Score:       2.5,
		Servers:     []api.PhysicalServer{{Status: constants.StatusOnline, EntryIP: "127.0.0.1"}},
	}

	cfg := &config.Config{
		FreeOnly: true,
		AutoPing: false,
	}
	selector := NewServerSelector(cfg)
	best, ping, err := selector.SelectBestWithPing([]api.LogicalServer{srv2, srv1})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if best.Name != "US-EAST#1" {
		t.Fatalf("expected US-EAST#1 to be selected by score, got %s", best.Name)
	}
	if ping != 0 {
		t.Fatalf("expected ping=0 when AutoPing=false, got %d", ping)
	}
}

func TestRegionalCandidatesCoverLocationsBeyondGlobalTopTen(t *testing.T) {
	var all []api.LogicalServer
	for i := range 12 {
		srv := server("US", api.TierFree, 0)
		srv.Name = fmt.Sprintf("US#%d", i)
		srv.Load = i
		srv.Servers[0].EntryIP = "192.0.2.1"
		all = append(all, srv)
	}
	for _, city := range []string{"Tokyo", "Osaka"} {
		srv := server("JP", api.TierFree, 0)
		srv.City, srv.Name, srv.Score = city, city, 1000
		srv.Servers[0].EntryIP = "192.0.2.2"
		all = append(all, srv)
	}
	got := regionalCandidates(all)
	if len(got) != 4 {
		t.Fatalf("expected two US candidates and both Japanese cities, got %v", got)
	}
	if got[1].City != "Osaka" || got[2].City != "Tokyo" {
		t.Fatalf("locations must precede alternate candidates: %v", got)
	}
	if all[0].Name != "US#0" {
		t.Fatal("input was mutated")
	}
}

func TestCapacityPriorityAndLatencyTiebreak(t *testing.T) {
	tests := []struct {
		name         string
		loads, pings [2]int
		want         string
	}{
		{"low load beats much lower ping", [2]int{80, 10}, [2]int{20, 200}, "B"},
		{"same load prefers lower ping", [2]int{20, 20}, [2]int{160, 80}, "B"},
		{"small load difference does not justify huge latency", [2]int{20, 21}, [2]int{400, 30}, "B"},
		{"failed ping never beats reachable server", [2]int{0, 95}, [2]int{999, 200}, "B"},
		{"unknown ping never beats reachable server", [2]int{0, 95}, [2]int{0, 200}, "B"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			candidates := []api.LogicalServer{{Name: "A", Load: tt.loads[0]}, {Name: "B", Load: tt.loads[1], Score: 10000}}
			got, ping, err := bestMeasuredCandidate(candidates, map[string]int{"A": tt.pings[0], "B": tt.pings[1]})
			if err != nil || got.Name != tt.want || ping != tt.pings[1] {
				t.Fatalf("got %v, %d, %v", got, ping, err)
			}
		})
	}
	if got, _, err := bestMeasuredCandidate([]api.LogicalServer{{Name: "A"}}, nil); err == nil || got != nil {
		t.Fatal("all failed probes must fail selection")
	}
}

func TestSpeedFinalistsPrioritizeDiversityAndAllowBlockedICMP(t *testing.T) {
	candidates := []api.LogicalServer{
		{Name: "US1", ExitCountry: "US", City: "NY", Load: 10},
		{Name: "US2", ExitCountry: "US", City: "NY", Load: 11},
		{Name: "JP", ExitCountry: "JP", City: "Tokyo", Load: 20},
	}
	got, err := speedFinalists(candidates, map[string]int{"US1": 50, "US2": 50, "JP": 999}, 2)
	if err != nil || len(got) != 2 || got[0].Name != "US1" || got[1].Name != "JP" {
		t.Fatalf("got %v %v", got, err)
	}
	if candidates[1].Name != "US2" {
		t.Fatal("mutated input")
	}
}

func TestExcludedCountriesCannotWinAutomaticSelection(t *testing.T) {
	servers := []api.LogicalServer{server("BR", api.TierFree, 0), server("US", api.TierFree, 0)}
	cfg := &config.Config{FreeOnly: true, ExcludedCountries: []string{"BR"}}
	got := EligibleServers(cfg, servers)
	if len(got) != 1 || got[0].ExitCountry != "US" {
		t.Fatalf("blocked exit eligible: %v", got)
	}
	cfg.Countries = []string{"BR"}
	if len(EligibleServers(cfg, servers)) != 0 {
		t.Fatal("country preference must not override exclusion")
	}
}
