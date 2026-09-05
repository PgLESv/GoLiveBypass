// Package main provides the command-line interface for generating ProtonVPN WireGuard configurations.
package main

import (
	"cmp"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"slices"
	"strings"
	"time"

	"protonvpn-wg-confgen/internal/api"
	"protonvpn-wg-confgen/internal/auth"
	"protonvpn-wg-confgen/internal/config"
	"protonvpn-wg-confgen/internal/constants"
	"protonvpn-wg-confgen/internal/routeprobe"
	"protonvpn-wg-confgen/internal/vpn"
	"protonvpn-wg-confgen/internal/wireguard"

	"github.com/ProtonVPN/go-vpn-lib/ed25519"
)

func main() {
	if err := run(); err != nil {
		isJSON := false
		for _, arg := range os.Args {
			if arg == "-json" || arg == "--json" {
				isJSON = true
				break
			}
		}
		if isJSON {
			response := map[string]any{
				"success": false,
				"error":   err.Error(),
			}
			var hvErr auth.HumanVerificationError
			if errors.As(err, &hvErr) {
				response["code"] = hvErr.Code
				response["retryable"] = hvErr.Retryable
				if hvErr.CaptchaURL != "" {
					response["captchaUrl"] = hvErr.CaptchaURL
				}
			}
			data, _ := json.Marshal(response)
			fmt.Println(string(data))
		} else {
			fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		}
		os.Exit(1)
	}
}

func run() error {
	if hasArg("-route-probe", "--route-probe") {
		result := routeprobe.Run(context.Background())
		data, _ := json.Marshal(result)
		fmt.Println(string(data))
		return nil
	}

	cfg, err := config.Parse()
	if err != nil {
		config.PrintUsage()
		return err
	}

	authClient := auth.NewClient(cfg)

	if cfg.CheckSession {
		session, timeUntilExpiry, err := authClient.CheckSession()
		if err != nil || session == nil {
			if cfg.JSONOutput {
				data, _ := json.Marshal(map[string]any{
					"success": false,
					"valid":   false,
					"error":   "Sessão expirada ou não encontrada",
				})
				fmt.Println(string(data))
				return nil
			}
			return fmt.Errorf("sessão expirada ou não encontrada")
		}
		if cfg.JSONOutput {
			data, _ := json.Marshal(map[string]any{
				"success":   true,
				"valid":     true,
				"username":  cfg.Username,
				"expiresIn": timeUntilExpiry.String(),
			})
			fmt.Println(string(data))
			return nil
		}
		fmt.Printf("Sessão válida para %s (expira em %s)\n", cfg.Username, timeUntilExpiry.String())
		return nil
	}

	session, err := authClient.Authenticate()
	if err != nil {
		return fmt.Errorf("authentication failed: %w", err)
	}
	if !cfg.JSONOutput {
		fmt.Println("Authentication successful!")
	}

	if cfg.LoginOnly {
		if cfg.JSONOutput {
			data, _ := json.Marshal(map[string]any{
				"success":  true,
				"username": cfg.Username,
			})
			fmt.Println(string(data))
			return nil
		}
		fmt.Printf("Login successful for %s!\n", cfg.Username)
		return nil
	}

	vpnClient := vpn.NewClient(cfg, session)

	switch {
	case cfg.ListConfigs:
		return listConfigs(vpnClient)
	case cfg.ListServers:
		return listServers(cfg, vpnClient)
	case cfg.RenewSerial != "":
		return renewSerial(cfg, vpnClient)
	default:
		return generateConfig(cfg, vpnClient)
	}
}

func hasArg(names ...string) bool {
	for _, arg := range os.Args[1:] {
		for _, name := range names {
			if arg == name {
				return true
			}
		}
	}
	return false
}

func generateConfig(cfg *config.Config, vpnClient *vpn.Client) error {
	keyPair, err := ed25519.NewKeyPair()
	if err != nil {
		return fmt.Errorf("failed to generate key pair: %w", err)
	}
	cfg.ClientPrivateKey = keyPair.ToX25519Base64()

	vpnInfo, err := vpnClient.GetCertificate(keyPair)
	if err != nil {
		return fmt.Errorf("failed to get VPN certificate: %w", err)
	}

	servers, err := vpnClient.GetServers()
	if err != nil {
		return fmt.Errorf("failed to get servers: %w", err)
	}

	selector := vpn.NewServerSelector(cfg)
	server, pingMs, err := selector.SelectBestWithPing(servers)
	if err != nil {
		return err
	}

	features := api.GetFeatureNames(server.Features)
	featureStr := ""
	if len(features) > 0 {
		featureStr = fmt.Sprintf(", Features: %s", strings.Join(features, ", "))
	}

	countryStr := server.ExitCountry
	if server.HostCountry != "" && server.HostCountry != server.ExitCountry {
		countryStr = fmt.Sprintf("%s (host: %s)", server.ExitCountry, server.HostCountry)
	}

	if !cfg.JSONOutput {
		pingInfo := ""
		if pingMs > 0 {
			pingInfo = fmt.Sprintf(", Ping: %dms", pingMs)
		}
		fmt.Printf("Selected server: %s (Country: %s, City: %s, Tier: %s, Load: %d%%, Score: %.2f%s, Servers: %d%s)\n",
			server.Name, countryStr, server.City, api.GetTierName(server.Tier),
			server.Load, server.Score, pingInfo, len(server.Servers), featureStr)
	}

	physicalServer := vpn.GetBestPhysicalServer(server)
	if physicalServer == nil {
		return fmt.Errorf("no physical servers available")
	}

	generator := wireguard.NewConfigGenerator(cfg)
	if err := generator.Generate(server, physicalServer, cfg.ClientPrivateKey, vpnInfo); err != nil {
		return fmt.Errorf("failed to generate WireGuard config: %w", err)
	}

	if cfg.JSONOutput {
		resp := map[string]any{
			"success":   true,
			"server":    server.Name,
			"country":   server.ExitCountry,
			"city":      server.City,
			"tier":      api.GetTierName(server.Tier),
			"load":      server.Load,
			"score":     server.Score,
			"pingMs":    pingMs,
			"endpoint":  fmt.Sprintf("%s:%d", physicalServer.EntryIP, constants.WireGuardPort),
			"confFile":  cfg.OutputFile,
			"expiresAt": vpnInfo.ExpirationTime,
		}
		data, _ := json.Marshal(resp)
		fmt.Println(string(data))
		return nil
	}

	fmt.Printf("WireGuard configuration written to: %s\n", cfg.OutputFile)
	if vpnInfo.DeviceName != "" {
		fmt.Printf("Device name: %s (visible in ProtonVPN dashboard)\n", vpnInfo.DeviceName)
	}
	mode := vpnInfo.Mode
	if mode == "" {
		mode = "session"
	}
	fmt.Printf("Certificate: %s, expires %s\n",
		mode, time.Unix(vpnInfo.ExpirationTime, 0).UTC().Format("2006-01-02 15:04 UTC"))
	fmt.Printf("\nSuccessfully generated config for %s\n", server.ExitCountry)
	return nil
}

func listServers(cfg *config.Config, vpnClient *vpn.Client) error {
	servers, err := vpnClient.GetServers()
	if err != nil {
		return fmt.Errorf("failed to get servers: %w", err)
	}

	filtered := vpn.EligibleServers(cfg, servers)

	if len(filtered) == 0 {
		if len(cfg.Countries) > 0 {
			return fmt.Errorf("no online servers found for countries: %v", cfg.Countries)
		}
		return fmt.Errorf("no online servers found")
	}

	slices.SortFunc(filtered, func(a, b api.LogicalServer) int {
		if c := cmp.Compare(a.ExitCountry, b.ExitCountry); c != 0 {
			return c
		}
		return cmp.Compare(a.Score, b.Score)
	})

	if cfg.JSONOutput {
		type serverJSON struct {
			Name     string   `json:"name"`
			Country  string   `json:"country"`
			City     string   `json:"city"`
			Tier     string   `json:"tier"`
			Load     int      `json:"load"`
			Score    float64  `json:"score"`
			Features []string `json:"features"`
		}
		list := make([]serverJSON, len(filtered))
		for i := range filtered {
			list[i] = serverJSON{
				Name:     filtered[i].Name,
				Country:  filtered[i].ExitCountry,
				City:     filtered[i].City,
				Tier:     api.GetTierName(filtered[i].Tier),
				Load:     filtered[i].Load,
				Score:    filtered[i].Score,
				Features: api.GetFeatureNames(filtered[i].Features),
			}
		}
		data, _ := json.Marshal(list)
		fmt.Println(string(data))
		return nil
	}

	fmt.Printf("%-7s  %-14s  %-18s  %5s  %6s  %-10s  %s\n",
		"Country", "Server", "City", "Load", "Score", "Tier", "Features")
	fmt.Println(strings.Repeat("-", 100))

	for i := range filtered {
		s := &filtered[i]
		features := api.GetFeatureNames(s.Features)
		featureStr := "-"
		if len(features) > 0 {
			featureStr = strings.Join(features, ", ")
		}

		serverName := s.Name
		if s.HostCountry != "" && s.HostCountry != s.ExitCountry {
			serverName = fmt.Sprintf("%s(%s)", s.Name, s.HostCountry)
		}
		fmt.Printf("%-7s  %-14s  %-18s  %3d%%  %6.2f  %-10s  %s\n",
			s.ExitCountry, serverName, s.City, s.Load, s.Score,
			api.GetTierName(s.Tier), featureStr)
	}

	// Count unique countries
	seen := map[string]struct{}{}
	for i := range filtered {
		seen[filtered[i].ExitCountry] = struct{}{}
	}
	fmt.Printf("\n%d servers found across %d countries.\n", len(filtered), len(seen))
	return nil
}

func renewSerial(cfg *config.Config, vpnClient *vpn.Client) error {
	certs, err := vpnClient.ListCertificates()
	if err != nil {
		return fmt.Errorf("failed to list certificates: %w", err)
	}

	var target *api.VPNCertificate
	for i := range certs {
		if certs[i].SerialNumber == cfg.RenewSerial {
			target = &certs[i]
			break
		}
	}

	if target == nil {
		return fmt.Errorf("certificate with SerialNumber %s not found (use -list-configs to see available certificates)", cfg.RenewSerial)
	}

	if target.ClientKey == "" {
		return fmt.Errorf("certificate %s has no public key data", cfg.RenewSerial)
	}

	deviceName := target.DeviceName
	if deviceName == "" {
		return fmt.Errorf("certificate %s has no device name", cfg.RenewSerial)
	}

	vpnInfo, err := vpnClient.RenewCertificate(target.ClientKey, deviceName)
	if err != nil {
		return fmt.Errorf("failed to renew certificate: %w", err)
	}

	fmt.Printf("Certificate renewed: %s\n", cfg.RenewSerial)
	fmt.Printf("Device name: %s\n", deviceName)
	fmt.Printf("New expiry: %s\n", time.Unix(vpnInfo.ExpirationTime, 0).UTC().Format("2006-01-02 15:04 UTC"))
	return nil
}

func listConfigs(vpnClient *vpn.Client) error {
	certs, err := vpnClient.ListCertificates()
	if err != nil {
		return fmt.Errorf("failed to list configurations: %w", err)
	}
	if len(certs) == 0 {
		fmt.Println("No persistent configurations found.")
		return nil
	}

	fmt.Printf("%-40s  %-30s  %-20s  %s\n", "SerialNumber", "DeviceName", "Expires", "Fingerprint")
	fmt.Println(strings.Repeat("-", 120))
	for _, c := range certs {
		exp := time.Unix(c.ExpirationTime, 0).UTC().Format("2006-01-02 15:04 UTC")
		name := c.DeviceName
		if name == "" {
			name = "-"
		}
		fmt.Printf("%-40s  %-30s  %-20s  %s\n", c.SerialNumber, name, exp, c.ClientKeyFingerprint)
	}
	fmt.Printf("\nTotal: %d\n", len(certs))
	return nil
}
