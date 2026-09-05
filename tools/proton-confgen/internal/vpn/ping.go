package vpn

import (
	"context"
	"math"
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
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	return probePingContext(ctx, ip)
}

func probePingContext(ctx context.Context, ip string) int {
	if ip == "" {
		return 999
	}

	// 1. Try system ICMP ping
	if ms, err := systemPingContext(ctx, ip); err == nil && ms > 0 {
		return ms
	}

	// 2. Fallback: TCP probe to port 443 or 80
	for _, port := range []string{"443", "80"} {
		start := time.Now()
		conn, err := (&net.Dialer{}).DialContext(ctx, "tcp", net.JoinHostPort(ip, port))
		if err == nil {
			_ = conn.Close()
			return max(1, int(time.Since(start).Milliseconds()))
		}
	}

	return 999
}

func systemPing(ip string, timeout time.Duration) (int, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	return systemPingContext(ctx, ip)
}

func systemPingContext(ctx context.Context, ip string) (int, error) {
	// Reserve time for TCP fallback when ICMP is filtered.
	icmpCtx, cancel := context.WithTimeout(ctx, 600*time.Millisecond)
	defer cancel()
	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		cmd = exec.CommandContext(icmpCtx, "ping", "-n", "1", "-w", "600", ip)
	} else {
		// Linux / macOS: 1 packet, 1s deadline
		cmd = exec.CommandContext(icmpCtx, "ping", "-c", "1", "-W", "1", ip)
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
				return max(1, int(math.Round(val))), nil
			}
		}
	}

	return 0, nil
}

// ProbeCandidatesPing covers the regional candidates with bounded concurrency
// and a shared deadline. Shared entry IPs are measured once, avoiding duplicate
// probes to the same physical machine. Missing/failed probes are not winners.
func ProbeCandidatesPing(servers []api.LogicalServer, maxCandidates int) map[string]int {
	ctx, cancel := context.WithTimeout(context.Background(), 18*time.Second)
	defer cancel()
	return probeCandidates(ctx, servers[:max(0, min(maxCandidates, len(servers)))], probePingContext)
}

func probeCandidates(ctx context.Context, servers []api.LogicalServer, probe func(context.Context, string) int) map[string]int {
	byIP := make(map[string][]string)
	var ips []string
	for _, srv := range servers {
		phys := GetBestPhysicalServer(&srv)
		if phys == nil || phys.EntryIP == "" {
			continue
		}
		if _, exists := byIP[phys.EntryIP]; !exists {
			ips = append(ips, phys.EntryIP)
		}
		byIP[phys.EntryIP] = append(byIP[phys.EntryIP], srv.Name)
	}
	results := make(map[string]int)
	jobs := make(chan string)
	var mu sync.Mutex
	var wg sync.WaitGroup
	for range min(32, len(ips)) {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for ip := range jobs {
				if ctx.Err() != nil {
					continue
				}
				probeCtx, cancel := context.WithTimeout(ctx, 1200*time.Millisecond)
				ms := probe(probeCtx, ip)
				cancel()
				mu.Lock()
				for _, name := range byIP[ip] {
					results[name] = ms
				}
				mu.Unlock()
			}
		}()
	}
send:
	for _, ip := range ips {
		select {
		case jobs <- ip:
		case <-ctx.Done():
			break send
		}
	}
	close(jobs)
	wg.Wait()
	return results
}
