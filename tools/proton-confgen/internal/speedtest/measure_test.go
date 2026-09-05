package speedtest

import (
	"context"
	"errors"
	"io"
	"math"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"protonvpn-wg-confgen/internal/api"
)

func speedHandler(t *testing.T) http.Handler {
	t.Helper()
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/__down" {
			n, _ := strconv.Atoi(r.URL.Query().Get("bytes"))
			if n < 0 || n > downloadBytes {
				w.WriteHeader(400)
				return
			}
			w.Header().Set("Content-Length", strconv.Itoa(n))
			_, _ = w.Write(make([]byte, n))
		} else if r.URL.Path == "/__up" {
			n, err := io.Copy(io.Discard, r.Body)
			if err != nil || n == 0 {
				w.WriteHeader(400)
				return
			}
			_, _ = w.Write([]byte("{}"))
		} else {
			w.WriteHeader(404)
		}
	})
}

func TestMeasureHTTPTransfersAndRejectsTruncation(t *testing.T) {
	srv := httptest.NewServer(speedHandler(t))
	defer srv.Close()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	m, err := measureHTTP(ctx, srv.Client(), srv.URL, 65536, 32768)
	if err != nil || capacity(m) <= 0 || m.LatencyMs <= 0 {
		t.Fatalf("measurement=%+v err=%v", m, err)
	}
	truncated := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte("short")) }))
	defer truncated.Close()
	if _, err := request(ctx, truncated.Client(), http.MethodGet, truncated.URL, nil, 100); err == nil {
		t.Fatal("truncated payload accepted")
	}
}

func TestRankingPrioritizesRealThroughputAndUpload(t *testing.T) {
	results := []Result{
		{Server: api.LogicalServer{Name: "low-ping"}, Measurement: Measurement{DownloadMbps: 2, UploadMbps: 1, LatencyMs: 15}},
		{Server: api.LogicalServer{Name: "fast"}, Measurement: Measurement{DownloadMbps: 60, UploadMbps: 20, LatencyMs: 150}},
		{Server: api.LogicalServer{Name: "bad-upload"}, Measurement: Measurement{DownloadMbps: 500, UploadMbps: 0.1, LatencyMs: 10}},
	}
	got, err := best(results)
	if err != nil || got.Server.Name != "fast" {
		t.Fatalf("got %v %v", got, err)
	}
	results[0].Measurement = results[1].Measurement
	results[0].LatencyMs = 20
	got, err = best(results)
	if err != nil || got.Server.Name != "low-ping" {
		t.Fatalf("latency must break equal throughput: %v %v", got, err)
	}
	for _, invalid := range []float64{0, -1, math.NaN(), math.Inf(1)} {
		if _, err := best([]Result{{Measurement: Measurement{DownloadMbps: invalid, UploadMbps: 20, LatencyMs: 10}}}); err == nil {
			t.Fatal("invalid measurement accepted")
		}
	}
}

func TestSelectionSkipsFailuresAndRunsSequentially(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	order := []string{}
	got, err := selectMeasured(ctx, []api.LogicalServer{{Name: "bad"}, {Name: "good"}, {Name: "unused"}}, func(ctx context.Context, s api.LogicalServer) (Measurement, error) {
		if _, ok := ctx.Deadline(); !ok {
			t.Fatal("missing candidate deadline")
		}
		order = append(order, s.Name)
		if s.Name == "bad" {
			return Measurement{}, errors.New("timeout")
		}
		cancel()
		return Measurement{DownloadMbps: 20, UploadMbps: 10, LatencyMs: 50}, nil
	})
	if err != nil || got.Server.Name != "good" || got.Tested != 2 || got.Succeeded != 1 || len(order) != 2 {
		t.Fatalf("got=%+v order=%v err=%v", got, order, err)
	}
}
