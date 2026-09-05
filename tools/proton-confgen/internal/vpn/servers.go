package vpn

import (
	"cmp"
	"errors"
	"fmt"
	"math"
	"slices"
	"strings"
	"time"

	"protonvpn-wg-confgen/internal/api"
	"protonvpn-wg-confgen/internal/config"
	"protonvpn-wg-confgen/internal/constants"
)

// ServerSelector handles server selection logic
type ServerSelector struct {
	config *config.Config
}

// NewServerSelector creates a new server selector
func NewServerSelector(cfg *config.Config) *ServerSelector {
	return &ServerSelector{config: cfg}
}

// EligibleServers returns the online servers matching the configured filters,
// preserving input order. An empty country list matches every country, which is
// what the listing mode uses; selection always has at least one country set.
func EligibleServers(cfg *config.Config, servers []api.LogicalServer) []api.LogicalServer {
	filtered := make([]api.LogicalServer, 0, len(servers))
	for i := range servers {
		if isEligible(cfg, &servers[i]) {
			filtered = append(filtered, servers[i])
		}
	}
	return filtered
}

func isEligible(cfg *config.Config, server *api.LogicalServer) bool {
	if server.Status != constants.StatusOnline || len(server.Servers) == 0 {
		return false
	}
	// Free tier is opt-in: -free-only selects it exclusively, otherwise it is excluded.
	if cfg.FreeOnly != (server.Tier == api.TierFree) {
		return false
	}
	if slices.Contains(cfg.ExcludedCountries, server.ExitCountry) {
		return false
	}
	if len(cfg.Countries) > 0 {
		if !slices.Contains(cfg.Countries, server.ExitCountry) {
			return false
		}
	} else {
		// Na seleção automática (sem país explícito), exclui saída brasileira (BR)
		// para garantir que o gateway do Discord saia por uma região sem bloqueio do Go Live.
		if server.ExitCountry == "BR" {
			return false
		}
	}
	// The P2P filter does not apply to Secure Core or Free tier selections.
	if cfg.P2PServersOnly && !cfg.SecureCoreOnly && !cfg.FreeOnly && server.Features&api.FeatureP2P == 0 {
		return false
	}
	return !cfg.SecureCoreOnly || server.Features&api.FeatureSecureCore != 0
}

// SelectBest selects the best server based on configuration
func (s *ServerSelector) SelectBest(servers []api.LogicalServer) (*api.LogicalServer, error) {
	server, _, err := s.SelectBestWithPing(servers)
	return server, err
}

// SelectBestWithPing selects the best server, factoring in real-time ping if AutoPing is enabled.
func (s *ServerSelector) SelectBestWithPing(servers []api.LogicalServer) (*api.LogicalServer, int, error) {
	// If a specific server is requested, find it by exact name match
	if s.config.ServerName != "" {
		for i := range servers {
			if servers[i].Name == s.config.ServerName && servers[i].Status == constants.StatusOnline {
				phys := GetBestPhysicalServer(&servers[i])
				pingMs := 0
				if phys != nil && s.config.AutoPing {
					pingMs = ProbePing(phys.EntryIP, 1200*time.Millisecond)
				}
				return &servers[i], pingMs, nil
			}
		}
		return nil, 0, fmt.Errorf("server %q not found or offline", s.config.ServerName)
	}

	filtered := EligibleServers(s.config, servers)

	if s.config.Debug {
		s.printDebugServerList(filtered)
	}

	if len(filtered) == 0 {
		return nil, 0, s.buildNoServersError()
	}

	// Sort servers: lowest score first (Proton API convention: lower = better for Quick Connect),
	// with lower load as tiebreaker.
	slices.SortFunc(filtered, func(a, b api.LogicalServer) int {
		if c := cmp.Compare(a.Score, b.Score); c != 0 {
			return c
		}
		return cmp.Compare(a.Load, b.Load)
	})

	if !s.config.AutoPing {
		return &filtered[0], 0, nil
	}

	// Represent every eligible location rather than letting the API's global
	// top ten hide entire regions. Two low-load choices per location provide a
	// fallback without probing thousands of near-identical logical servers.
	candidates := regionalCandidates(filtered)
	pings := ProbeCandidatesPing(candidates, len(candidates))
	return bestMeasuredCandidate(candidates, pings)

}

// regionalCandidates considers every eligible server and retains the two
// lowest-load choices in each country/region/city. Input is not mutated.
func regionalCandidates(servers []api.LogicalServer) []api.LogicalServer {
	ordered := slices.Clone(servers)
	slices.SortFunc(ordered, func(a, b api.LogicalServer) int {
		if c := cmp.Compare(a.Load, b.Load); c != 0 {
			return c
		}
		if c := cmp.Compare(a.Score, b.Score); c != 0 {
			return c
		}
		return cmp.Compare(a.Name, b.Name)
	})
	type location struct{ country, region, city string }
	counts := make(map[location]int)
	var first, second []api.LogicalServer
	for _, srv := range ordered {
		phys := GetBestPhysicalServer(&srv)
		if phys == nil || phys.EntryIP == "" {
			continue
		}
		key := location{strings.ToUpper(srv.ExitCountry), strings.ToLower(strings.TrimSpace(srv.Region)), strings.ToLower(strings.TrimSpace(srv.City))}
		switch counts[key] {
		case 0:
			first = append(first, srv)
		case 1:
			second = append(second, srv)
		}
		counts[key]++
	}
	// First cover all locations, then their alternate candidates.
	return append(first, second...)
}

// Lower load is an estimate of available capacity, NOT measured bandwidth.
// Normalize both signals so 70% capacity / 30% latency has a stable meaning.
// API Score breaks ties only; its undocumented scale must not dominate RTT.
func routeCost(load, ping int) float64 {
	capacityPenalty := math.Max(0, math.Min(100, float64(load))) / 100
	latencyPenalty := math.Min(float64(ping), 500) / 500
	return 0.7*capacityPenalty + 0.3*latencyPenalty
}

func bestMeasuredCandidate(candidates []api.LogicalServer, pings map[string]int) (*api.LogicalServer, int, error) {
	var best *api.LogicalServer
	bestPing := 0
	bestCost := math.Inf(1)
	for i := range candidates {
		srv := &candidates[i]
		ping := pings[srv.Name]
		if ping <= 0 || ping >= 999 {
			continue
		}
		cost := routeCost(srv.Load, ping)
		if best == nil || cost < bestCost || (cost == bestCost && (ping < bestPing || (ping == bestPing && (srv.Score < best.Score || (srv.Score == best.Score && srv.Name < best.Name))))) {
			best, bestPing, bestCost = srv, ping, cost
		}
	}
	if best == nil {
		return nil, 0, errors.New("nenhum servidor respondeu ao teste de latência; tente novamente ou escolha outra região")
	}
	return best, bestPing, nil
}

// SpeedCandidates uses the global regional scan as a shortlist, not as a
// substitute for throughput. Prefer distinct locations before filling slots.
func (s *ServerSelector) SpeedCandidates(servers []api.LogicalServer, limit int) ([]api.LogicalServer, error) {
	candidates := regionalCandidates(EligibleServers(s.config, servers))
	pings := ProbeCandidatesPing(candidates, len(candidates))
	return speedFinalists(candidates, pings, limit)
}

func speedFinalists(candidates []api.LogicalServer, pings map[string]int, limit int) ([]api.LogicalServer, error) {
	candidates = slices.Clone(candidates)
	slices.SortFunc(candidates, func(a, b api.LogicalServer) int {
		pa, pb := pings[a.Name], pings[b.Name]
		if pa <= 0 {
			pa = 999
		}
		if pb <= 0 {
			pb = 999
		}
		va, vb := pa < 999, pb < 999
		if va != vb {
			if va {
				return -1
			}
			return 1
		}
		if c := cmp.Compare(routeCost(a.Load, pa), routeCost(b.Load, pb)); c != 0 {
			return c
		}
		return cmp.Compare(a.Name, b.Name)
	})
	var selected, rest []api.LogicalServer
	seen := make(map[string]bool)
	for _, srv := range candidates {
		// ICMP/TCP failure is not proof that WireGuard is unusable. Keep such
		// candidates as fallbacks; only the real transfer can qualify the winner.
		key := srv.ExitCountry + "/" + srv.Region + "/" + srv.City
		if seen[key] {
			rest = append(rest, srv)
		} else {
			selected = append(selected, srv)
			seen[key] = true
		}
	}
	selected = append(selected, rest...)
	if len(selected) == 0 {
		return nil, errors.New("nenhum candidato elegível na busca regional")
	}
	return selected[:min(max(0, limit), len(selected))], nil
}

func (s *ServerSelector) buildNoServersError() error {
	errMsg := fmt.Sprintf("no suitable servers found for countries: %v", s.config.Countries)

	if s.config.SecureCoreOnly {
		errMsg += " with Secure Core"
	} else if s.config.P2PServersOnly {
		errMsg += " with P2P support"
	}

	return errors.New(errMsg)
}

// GetBestPhysicalServer returns the first online physical server, or nil if the
// logical server has none. Returning an offline server would produce a config
// pointing at a dead endpoint.
func GetBestPhysicalServer(server *api.LogicalServer) *api.PhysicalServer {
	for i := range server.Servers {
		if server.Servers[i].Status == constants.StatusOnline {
			return &server.Servers[i]
		}
	}
	return nil
}

// printDebugServerList prints a debug list of filtered servers
func (s *ServerSelector) printDebugServerList(servers []api.LogicalServer) {
	fmt.Printf("\nDEBUG: Found %d servers after filtering:\n", len(servers))
	fmt.Println("==================================================================================")
	fmt.Printf("%-15s | %-18s | %-12s | Load | Score | Features\n", "Server", "City", "Tier")
	fmt.Println("----------------------------------------------------------------------------------")

	for i := range servers {
		features := api.GetFeatureNames(servers[i].Features)
		featureStr := "-"
		if len(features) > 0 {
			featureStr = strings.Join(features, ", ")
		}

		fmt.Printf("%-15s | %-18s | %-12s | %3d%% | %.2f | %s\n",
			servers[i].Name,
			servers[i].City,
			api.GetTierName(servers[i].Tier),
			servers[i].Load,
			servers[i].Score,
			featureStr)
	}

	fmt.Println("==================================================================================")
}
