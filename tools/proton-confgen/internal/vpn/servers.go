package vpn

import (
	"cmp"
	"errors"
	"fmt"
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

	// Probe up to top 10 candidates
	const maxCandidates = 10
	candidatesCount := len(filtered)
	if candidatesCount > maxCandidates {
		candidatesCount = maxCandidates
	}
	candidates := filtered[:candidatesCount]
	pings := ProbeCandidatesPing(candidates, candidatesCount)

	type scoredServer struct {
		server *api.LogicalServer
		score  float64
		ping   int
	}

	scored := make([]scoredServer, len(candidates))
	for i := range candidates {
		srv := &candidates[i]
		pingMs, ok := pings[srv.Name]
		if !ok || pingMs <= 0 || pingMs > 990 {
			pingMs = 999
		}
		// Combined score: lower is better
		// Weighting: Proton Score (x20) + Ping (x0.5) + Load (x0.3)
		comb := (srv.Score * 20.0) + (float64(pingMs) * 0.5) + (float64(srv.Load) * 0.3)
		scored[i] = scoredServer{server: srv, score: comb, ping: pingMs}
	}

	slices.SortFunc(scored, func(a, b scoredServer) int {
		return cmp.Compare(a.score, b.score)
	})

	return scored[0].server, scored[0].ping, nil
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
