package vpn

import (
	"context"
	"net"
	"os/exec"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"protonvpn-wg-confgen/internal/api"
)

var (
	pingLinuxRegex   = regexp.MustCompile(`(?:time|tempo)=([0-9.]+)\s*ms`)
	pingWindowsRegex = regexp.MustCompile(`(?:time|tempo)[=<]([0-9]+)ms`)
)

// ProbePing measures round-trip time (RTT) to an IP address in milliseconds.
func ProbePing(ip string, timeout time.Duration) int {
	if ip == "" {
		return 999
	}

	// 1. Try system ICMP ping
	if ms, err := systemPing(ip, timeout); err == nil && ms > 0 {
		return ms
	}

	// 2. Fallback: TCP probe to port 443 or 80
	for _, port := range []string{"443", "80"} {
		start := time.Now()
		conn, err := net.DialTimeout("tcp", net.JoinHostPort(ip, port), timeout)
		if err == nil {
			_ = conn.Close()
			return int(time.Since(start).Milliseconds())
		}
	}

	return 999
}

func systemPing(ip string, timeout time.Duration) (int, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		cmd = exec.CommandContext(ctx, "ping", "-n", "1", "-w", strconv.Itoa(int(timeout.Milliseconds())), ip)
	} else {
		// Linux / macOS: 1 packet, 1s deadline
		cmd = exec.CommandContext(ctx, "ping", "-c", "1", "-W", "1", ip)
	}

	out, err := cmd.CombinedOutput()
	if err != nil {
		return 0, err
	}

	text := strings.ToLower(string(out))
	if runtime.GOOS == "windows" {
		if strings.Contains(text, "<1ms") {
			return 1, nil
		}
		matches := pingWindowsRegex.FindStringSubmatch(text)
		if len(matches) > 1 {
			if val, err := strconv.Atoi(matches[1]); err == nil {
				return val, nil
			}
		}
	} else {
		matches := pingLinuxRegex.FindStringSubmatch(text)
		if len(matches) > 1 {
			if val, err := strconv.ParseFloat(matches[1], 64); err == nil {
				return int(val + 0.5), nil
			}
		}
	}

	return 0, nil
}

// ProbeCandidatesPing measures ping for up to maxCandidates servers concurrently.
func ProbeCandidatesPing(servers []api.LogicalServer, maxCandidates int) map[string]int {
	if maxCandidates > len(servers) {
		maxCandidates = len(servers)
	}

	results := make(map[string]int, maxCandidates)
	var mu sync.Mutex
	var wg sync.WaitGroup

	sem := make(chan struct{}, 6) // Max 6 parallel pings

	for i := 0; i < maxCandidates; i++ {
		server := servers[i]
		phys := GetBestPhysicalServer(&server)
		if phys == nil || phys.EntryIP == "" {
			continue
		}

		wg.Add(1)
		go func(srvName, ip string) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			ms := ProbePing(ip, 1200*time.Millisecond)

			mu.Lock()
			results[srvName] = ms
			mu.Unlock()
		}(server.Name, phys.EntryIP)
	}

	wg.Wait()
	return results
}
