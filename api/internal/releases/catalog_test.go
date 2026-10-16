package releases

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/bezumiya/GoLiveBypass/api/internal/gh"
)

type fakeSource struct {
	release gh.Release
	err     error
	list    []gh.Release
	listErr error
	calls   int
}

func (f *fakeSource) LatestStableRelease(context.Context) (gh.Release, error) {
	f.calls++
	return f.release, f.err
}

func (f *fakeSource) ListReleases(context.Context) ([]gh.Release, error) {
	return f.list, f.listErr
}

func validRelease() gh.Release {
	return gh.Release{
		TagName:     "v2.0.4",
		Name:        "GoLiveBypass 2.0.4",
		PublishedAt: "2026-09-05T12:00:00Z",
		HTMLURL:     "https://github.com/owner/repo/releases/tag/v2.0.4",
		Assets: []gh.ReleaseAsset{
			{Name: "GoLiveBypass-2.0.4.exe", BrowserDownloadURL: "https://github.com/owner/repo/releases/download/v2.0.4/GoLiveBypass-2.0.4.exe"},
			{Name: "GoLiveBypass-2.0.4.AppImage", BrowserDownloadURL: "https://github.com/owner/repo/releases/download/v2.0.4/GoLiveBypass-2.0.4.AppImage"},
			{Name: "GoLiveBypass.dmg", BrowserDownloadURL: "https://github.com/owner/repo/releases/download/v2.0.4/GoLiveBypass.dmg"},
			{Name: "GoLiveBypass.zip", BrowserDownloadURL: "https://github.com/owner/repo/releases/download/v2.0.4/GoLiveBypass.zip"},
			{Name: "goLiveBypass-vencord.zip", BrowserDownloadURL: "https://github.com/owner/repo/releases/download/v2.0.4/goLiveBypass-vencord.zip"},
			{Name: "goLiveBypass-vencord.zip.sha256", BrowserDownloadURL: "https://github.com/owner/repo/releases/download/v2.0.4/goLiveBypass-vencord.zip.sha256"},
			{Name: "GoLiveBypass-2.0.4-bypass.js", BrowserDownloadURL: "https://github.com/owner/repo/releases/download/v2.0.4/GoLiveBypass-2.0.4-bypass.js"},
			{Name: "GoLiveBypass-2.0.4-bypass.js.sha256", BrowserDownloadURL: "https://github.com/owner/repo/releases/download/v2.0.4/GoLiveBypass-2.0.4-bypass.js.sha256"},
		},
	}
}

func TestBuildCatalogStableAliases(t *testing.T) {
	catalog, err := buildCatalog(validRelease(), nil)
	if err != nil {
		t.Fatalf("buildCatalog() error = %v", err)
	}
	if catalog.Version != "2.0.4" || catalog.Channel != "stable" || catalog.Stale {
		t.Fatalf("catalog = %+v", catalog)
	}
	for _, alias := range []string{"windows", "linux", "plugin", "plugin-sha", "standalone", "standalone-sha"} {
		if catalog.Assets[alias].URL == "" {
			t.Errorf("asset %q ausente", alias)
		}
	}
}

// O DMG do macOS sai da release própria do cliente (macos-vX.Y.Z), nunca dos
// assets da release estável da GUI: o GoLiveBypass.dmg de lá é build da GUI sem
// assinatura e com auto-update desligado no código.
func TestBuildCatalogMacOSAssetsComeFromMacOSRelease(t *testing.T) {
	gui := validRelease()
	mac := gh.Release{
		TagName:     "macos-v0.6.0",
		Name:        "GoLiveBypass macOS 0.6.0",
		PublishedAt: "2026-10-11T03:25:00Z",
		HTMLURL:     "https://github.com/owner/repo/releases/tag/macos-v0.6.0",
		Assets: []gh.ReleaseAsset{
			{Name: "GoLiveBypass-macos-0.6.0-universal.dmg", BrowserDownloadURL: "https://github.com/owner/repo/releases/download/macos-v0.6.0/GoLiveBypass-macos-0.6.0-universal.dmg"},
			{Name: "GoLiveBypass-macos-0.6.0-universal.dmg.sha256", BrowserDownloadURL: "https://github.com/owner/repo/releases/download/macos-v0.6.0/GoLiveBypass-macos-0.6.0-universal.dmg.sha256"},
		},
	}
	catalog, err := buildCatalog(gui, &mac)
	if err != nil {
		t.Fatalf("buildCatalog() error = %v", err)
	}
	asset, ok := catalog.Assets["mac-dmg"]
	if !ok {
		t.Fatal("alias mac-dmg ausente")
	}
	if asset.Name != "GoLiveBypass-macos-0.6.0-universal.dmg" {
		t.Fatalf("mac-dmg = %q, devia ser o DMG universal da release própria", asset.Name)
	}
	if catalog.MacOS == nil || catalog.MacOS.Version != "0.6.0" || catalog.MacOS.Tag != "macos-v0.6.0" {
		t.Fatalf("MacOS = %+v", catalog.MacOS)
	}
	// O ZIP deixou de existir no cliente novo; o alias não pode ser servido.
	if _, ok := catalog.Assets["mac-zip"]; ok {
		t.Fatal("mac-zip nao existe mais no cliente macOS e nao devia ser exposto")
	}
}

// Sem release própria, o botão do macOS fica indisponível em vez de apontar para
// um arquivo antigo.
func TestBuildCatalogWithoutMacOSReleaseHidesAlias(t *testing.T) {
	gui := validRelease()
	catalog, err := buildCatalog(gui, nil)
	if err != nil {
		t.Fatalf("buildCatalog() error = %v", err)
	}
	if _, ok := catalog.Assets["mac-dmg"]; ok {
		t.Fatal("sem release própria o alias mac-dmg nao devia existir")
	}
	if catalog.MacOS != nil {
		t.Fatalf("MacOS devia ser nulo, veio %+v", catalog.MacOS)
	}
}

func TestBuildCatalogRejectsPrereleaseAndUnsafeURLs(t *testing.T) {
	release := validRelease()
	release.Prerelease = true
	if _, err := buildCatalog(release, nil); !errors.Is(err, ErrNoStableRelease) {
		t.Fatalf("prerelease err = %v", err)
	}

	release = validRelease()
	release.Assets[0].BrowserDownloadURL = "http://github.com/owner/repo/download.exe"
	catalog, err := buildCatalog(release, nil)
	if err != nil {
		t.Fatalf("URL insegura nao deveria invalidar catalogo inteiro: %v", err)
	}
	if _, ok := catalog.Assets["windows"]; ok {
		t.Fatal("asset HTTP nao deveria ser exposto")
	}
}

// A lista de releases é opcional: se falhar, o catálogo serve o resto sem o macOS.
func TestCatalogCacheToleratesListReleasesFailure(t *testing.T) {
	source := &fakeSource{release: validRelease(), listErr: errors.New("github fora do ar")}
	cache := NewCatalogCache(source, time.Minute)
	catalog, err := cache.Latest(context.Background())
	if err != nil {
		t.Fatalf("Latest() error = %v", err)
	}
	if _, ok := catalog.Assets["mac-dmg"]; ok {
		t.Fatal("com a lista indisponivel o alias mac-dmg nao devia aparecer")
	}
	if catalog.Assets["windows"].URL == "" {
		t.Fatal("o resto do catálogo devia continuar servindo")
	}
}

func TestCatalogCacheUsesTTLAndRefreshes(t *testing.T) {
	source := &fakeSource{release: validRelease()}
	cache := NewCatalogCache(source, time.Minute)
	now := time.Unix(100, 0)
	cache.now = func() time.Time { return now }

	first, err := cache.Latest(context.Background())
	if err != nil {
		t.Fatalf("primeira consulta: %v", err)
	}
	if source.calls != 1 || first.Stale {
		t.Fatalf("primeira consulta = %+v, calls=%d", first, source.calls)
	}

	now = now.Add(30 * time.Second)
	if _, err := cache.Latest(context.Background()); err != nil {
		t.Fatalf("consulta no TTL: %v", err)
	}
	if source.calls != 1 {
		t.Fatalf("source foi consultada %d vezes dentro do TTL", source.calls)
	}

	now = now.Add(31 * time.Second)
	if _, err := cache.Latest(context.Background()); err != nil {
		t.Fatalf("consulta apos TTL: %v", err)
	}
	if source.calls != 2 {
		t.Fatalf("source foi consultada %d vezes apos expirar", source.calls)
	}
}

func TestCatalogCacheServesStaleFallback(t *testing.T) {
	source := &fakeSource{release: validRelease()}
	cache := NewCatalogCache(source, time.Minute)
	cache.now = func() time.Time { return time.Unix(100, 0) }
	if _, err := cache.Latest(context.Background()); err != nil {
		t.Fatal(err)
	}

	source.err = errors.New("github fora do ar")
	cache.Invalidate()
	catalog, err := cache.Latest(context.Background())
	if err != nil {
		t.Fatalf("fallback retornou erro: %v", err)
	}
	if !catalog.Stale || catalog.Version != "2.0.4" {
		t.Fatalf("fallback = %+v", catalog)
	}
}

func TestCatalogDownloadOnlyAllowsKnownAliases(t *testing.T) {
	source := &fakeSource{release: validRelease()}
	cache := NewCatalogCache(source, time.Minute)
	if got, err := cache.Download(context.Background(), "windows"); err != nil || got == "" {
		t.Fatalf("windows = %q, err = %v", got, err)
	}
	if _, err := cache.Download(context.Background(), "https://evil.example"); !errors.Is(err, ErrUnknownAsset) {
		t.Fatalf("alias arbitrario err = %v", err)
	}
}
