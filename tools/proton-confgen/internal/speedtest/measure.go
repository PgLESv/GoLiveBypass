package speedtest

import (
	"bytes"
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"slices"
	"sync/atomic"
	"time"

	"protonvpn-wg-confgen/internal/api"
	"protonvpn-wg-confgen/internal/vpn"
)

const (
	downloadBytes = 4 * 1024 * 1024
	uploadBytes   = 1024 * 1024
	speedEndpoint = "https://speed.cloudflare.com"
)

type Measurement struct {
	DownloadMbps float64 `json:"downloadMbps"`
	UploadMbps   float64 `json:"uploadMbps"`
	LatencyMs    int     `json:"latencyMs"`
}

type Result struct {
	Server api.LogicalServer
	Measurement
	Tested    int `json:"tested"`
	Succeeded int `json:"succeeded"`
}

// MeasureCandidate opens and closes its own tunnel. DNS and all HTTP traffic
// use netstack exclusively; a failed WireGuard handshake cannot fall back direct.
func MeasureCandidate(ctx context.Context, privateKey string, server api.LogicalServer) (Measurement, error) {
	peer := vpn.GetBestPhysicalServer(&server)
	if peer == nil {
		return Measurement{}, errors.New("servidor sem endpoint ativo")
	}
	client, closeTunnel, err := tunnelClient(privateKey, *peer)
	if err != nil {
		return Measurement{}, err
	}
	defer closeTunnel()
	return measureHTTP(ctx, client, speedEndpoint, downloadBytes, uploadBytes)
}

type countingReader struct {
	reader io.Reader
	count  atomic.Int64
}

func (r *countingReader) Read(p []byte) (int, error) {
	n, err := r.reader.Read(p)
	r.count.Add(int64(n))
	return n, err
}

func request(ctx context.Context, client *http.Client, method, url string, body []byte, expected int64) (time.Duration, error) {
	sent := &countingReader{reader: bytes.NewReader(body)}
	var requestBody io.Reader
	if method == http.MethodPost {
		requestBody = sent
	}
	req, err := http.NewRequestWithContext(ctx, method, url, requestBody)
	if err != nil {
		return 0, err
	}
	req.Header.Set("Cache-Control", "no-store")
	if method == http.MethodPost {
		req.ContentLength = int64(len(body))
		req.Header.Set("Content-Type", "application/octet-stream")
	}
	start := time.Now()
	res, err := client.Do(req)
	if err != nil {
		return 0, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return 0, fmt.Errorf("medição HTTP %d", res.StatusCode)
	}
	// Download must have exactly the requested bytes. Upload response is small
	// and untrusted: consume at most 64 KiB, accepting only completed responses.
	limit := expected + 1
	if expected < 0 {
		limit = 64 * 1024
	}
	n, err := io.Copy(io.Discard, io.LimitReader(res.Body, limit))
	if err != nil {
		return 0, err
	}
	if (expected >= 0 && n != expected) || (expected < 0 && n >= limit) {
		return 0, errors.New("resposta de medição incompleta ou inválida")
	}
	if method == http.MethodPost && sent.count.Load() != int64(len(body)) {
		return 0, errors.New("upload não foi enviado por completo")
	}
	return time.Since(start), nil
}

func measureHTTP(ctx context.Context, client *http.Client, base string, downBytes, upBytes int64) (Measurement, error) {
	// Warm up WireGuard, DNS and TLS; do not count their setup as transfer RTT.
	if _, err := request(ctx, client, http.MethodGet, base+"/__down?bytes=0", nil, 0); err != nil {
		return Measurement{}, err
	}
	latencies := make([]int, 0, 3)
	for range 3 {
		elapsed, err := request(ctx, client, http.MethodGet, base+"/__down?bytes=0", nil, 0)
		if err != nil {
			return Measurement{}, err
		}
		latencies = append(latencies, max(1, int(elapsed.Milliseconds())))
	}
	slices.Sort(latencies)
	down, err := request(ctx, client, http.MethodGet, fmt.Sprintf("%s/__down?bytes=%d", base, downBytes), nil, downBytes)
	if err != nil {
		return Measurement{}, err
	}
	payload := make([]byte, upBytes)
	if _, err := rand.Read(payload); err != nil {
		return Measurement{}, err
	}
	up, err := request(ctx, client, http.MethodPost, base+"/__up", payload, -1)
	if err != nil {
		return Measurement{}, err
	}
	downSec := max(down, time.Microsecond).Seconds()
	upSec := max(up, time.Microsecond).Seconds()
	return Measurement{DownloadMbps: float64(downBytes) * 8 / downSec / 1e6, UploadMbps: float64(upBytes) * 8 / upSec / 1e6, LatencyMs: latencies[1]}, nil
}

func capacity(m Measurement) float64 {
	if m.DownloadMbps <= 0 || m.UploadMbps <= 0 || math.IsNaN(m.DownloadMbps) || math.IsNaN(m.UploadMbps) || math.IsInf(m.DownloadMbps, 0) || math.IsInf(m.UploadMbps, 0) {
		return 0
	}
	// Harmonic mean prevents excellent download from hiding unusable upload.
	return 2 / (1/m.DownloadMbps + 1/m.UploadMbps)
}

func best(results []Result) (Result, error) {
	maxCapacity := 0.0
	for _, r := range results {
		maxCapacity = math.Max(maxCapacity, capacity(r.Measurement))
	}
	if maxCapacity == 0 {
		return Result{}, errors.New("nenhum servidor concluiu download e upload pelo túnel; a rota anterior foi preservada")
	}
	var chosen Result
	bestScore := -1.0
	for _, r := range results {
		c := capacity(r.Measurement)
		if c <= 0 || r.LatencyMs <= 0 {
			continue
		}
		score := 0.7*c/maxCapacity + 0.3*(1-math.Min(float64(r.LatencyMs), 500)/500)
		if score > bestScore || (score == bestScore && r.LatencyMs < chosen.LatencyMs) {
			chosen, bestScore = r, score
		}
	}
	if bestScore < 0 {
		return Result{}, errors.New("nenhuma medição válida de latência")
	}
	return chosen, nil
}

// Select measures sequentially: simultaneous transfers would compete for the
// user's bandwidth and corrupt the comparison. Each candidate has a 12s budget.
func Select(ctx context.Context, privateKey string, candidates []api.LogicalServer) (Result, error) {
	return selectMeasured(ctx, candidates, func(ctx context.Context, s api.LogicalServer) (Measurement, error) {
		return MeasureCandidate(ctx, privateKey, s)
	})
}

func selectMeasured(ctx context.Context, candidates []api.LogicalServer, measure func(context.Context, api.LogicalServer) (Measurement, error)) (Result, error) {
	var results []Result
	tested := 0
	for _, s := range candidates {
		if ctx.Err() != nil {
			break
		}
		candidateCtx, cancel := context.WithTimeout(ctx, 12*time.Second)
		m, err := measure(candidateCtx, s)
		cancel()
		tested++
		if err == nil {
			results = append(results, Result{Server: s, Measurement: m})
		}
	}
	result, err := best(results)
	result.Tested, result.Succeeded = tested, len(results)
	return result, err
}
