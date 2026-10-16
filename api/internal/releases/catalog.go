package releases

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/bezumiya/GoLiveBypass/api/internal/gh"
)

const DefaultTTL = 5 * time.Minute

var (
	ErrNoStableRelease  = errors.New("nenhuma release estavel valida foi encontrada")
	ErrUnknownAsset     = errors.New("alias de download desconhecido")
	ErrAssetUnavailable = errors.New("asset de download indisponivel na release atual")
)

type Source interface {
	LatestStableRelease(context.Context) (gh.Release, error)
	// ListReleases alimenta os aliases de macOS, que vivem em release própria
	// (macos-vX.Y.Z, make_latest=false) e por isso não aparecem na latest.
	ListReleases(context.Context) ([]gh.Release, error)
}

type Asset struct {
	Name string `json:"name"`
	URL  string `json:"url"`
}

// MacOSRelease descreve a release própria do cliente macOS. Os aliases de macOS
// apontam para ela, nunca para os assets da release estável da GUI.
type MacOSRelease struct {
	Tag         string `json:"tag"`
	Version     string `json:"version"`
	PublishedAt string `json:"published_at"`
	PageURL     string `json:"page_url"`
}

type Catalog struct {
	Tag         string           `json:"tag"`
	Version     string           `json:"version"`
	Name        string           `json:"name"`
	Channel     string           `json:"channel"`
	PublishedAt string           `json:"published_at"`
	PageURL     string           `json:"page_url"`
	Stale       bool             `json:"stale"`
	Assets      map[string]Asset `json:"assets"`
	MacOS       *MacOSRelease    `json:"macos,omitempty"`
}

type CatalogCache struct {
	source Source
	ttl    time.Duration
	now    func() time.Time

	mu        sync.RWMutex
	refreshMu sync.Mutex
	catalog   *Catalog
	expiresAt time.Time
}

func NewCatalogCache(source Source, ttl time.Duration) *CatalogCache {
	if ttl <= 0 {
		ttl = DefaultTTL
	}
	return &CatalogCache{source: source, ttl: ttl, now: time.Now}
}

func (c *CatalogCache) Latest(ctx context.Context) (Catalog, error) {
	if catalog, ok := c.snapshotFresh(); ok {
		return catalog, nil
	}

	c.refreshMu.Lock()
	defer c.refreshMu.Unlock()
	if catalog, ok := c.snapshotFresh(); ok {
		return catalog, nil
	}

	release, err := c.source.LatestStableRelease(ctx)
	var macOS *gh.Release
	if err == nil {
		// A release própria do macOS é opcional: se a lista falhar, degrada em vez
		// de derrubar o catálogo inteiro. Sem ela a página mostra o botão do macOS
		// indisponível — nunca o DMG antigo da GUI.
		if list, listErr := c.source.ListReleases(ctx); listErr == nil {
			if found, ok := gh.LatestMacOSRelease(list); ok {
				macOS = &found
			}
		}
	}
	if err == nil {
		catalog, buildErr := buildCatalog(release, macOS)
		if buildErr == nil {
			c.mu.Lock()
			c.catalog = &catalog
			c.expiresAt = c.now().Add(c.ttl)
			c.mu.Unlock()
			return cloneCatalog(catalog), nil
		}
		err = buildErr
	}

	if catalog, ok := c.snapshot(); ok {
		catalog.Stale = true
		return catalog, nil
	}
	return Catalog{}, err
}

func (c *CatalogCache) Download(ctx context.Context, alias string) (string, error) {
	catalog, err := c.Latest(ctx)
	if err != nil {
		return "", err
	}
	_, ok := knownAliases[alias]
	if !ok {
		return "", ErrUnknownAsset
	}
	asset, ok := catalog.Assets[alias]
	if !ok || asset.URL == "" {
		return "", ErrAssetUnavailable
	}
	return asset.URL, nil
}

func (c *CatalogCache) Invalidate() {
	c.mu.Lock()
	c.expiresAt = time.Time{}
	c.mu.Unlock()
}

var stableTag = regexp.MustCompile(`^v?([0-9]+\.[0-9]+\.[0-9]+)$`)

var knownAliases = map[string]struct{}{
	"windows": {}, "linux": {}, "mac-dmg": {},
	"plugin": {}, "plugin-sha": {}, "standalone": {}, "standalone-sha": {},
}

func buildCatalog(release gh.Release, macOS *gh.Release) (Catalog, error) {
	match := stableTag.FindStringSubmatch(strings.TrimSpace(release.TagName))
	if release.Draft || release.Prerelease || len(match) != 2 {
		return Catalog{}, fmt.Errorf("%w: tag %q", ErrNoStableRelease, release.TagName)
	}
	if !isHTTPSURL(release.HTMLURL) {
		return Catalog{}, fmt.Errorf("%w: pagina da release invalida", ErrNoStableRelease)
	}

	version := match[1]
	wanted := map[string]string{
		"windows":        "GoLiveBypass-" + version + ".exe",
		"linux":          "GoLiveBypass-" + version + ".AppImage",
		"plugin":         "goLiveBypass-vencord.zip",
		"plugin-sha":     "goLiveBypass-vencord.zip.sha256",
		"standalone":     "GoLiveBypass-" + version + "-bypass.js",
		"standalone-sha": "GoLiveBypass-" + version + "-bypass.js.sha256",
	}

	byName := make(map[string]string, len(release.Assets))
	for _, asset := range release.Assets {
		if asset.Name == "" || !isHTTPSURL(asset.BrowserDownloadURL) {
			continue
		}
		byName[asset.Name] = asset.BrowserDownloadURL
	}
	assets := make(map[string]Asset, len(wanted))
	for alias, name := range wanted {
		if assetURL := byName[name]; assetURL != "" {
			assets[alias] = Asset{Name: name, URL: assetURL}
		}
	}

	// O DMG do macOS não vem daqui. O cliente é outra aplicação, com tag própria
	// (macos-vX.Y.Z) e make_latest=false; o GoLiveBypass.dmg que a GUI publicava
	// na estável era build sem assinatura e com auto-update desligado no código —
	// servir esse arquivo seria oferecer um app que nunca atualiza. Sem a release
	// própria o alias não aparece e a página mostra o botão indisponível.
	var macInfo *MacOSRelease
	if macOS != nil {
		if m := macOSTagRelease.FindStringSubmatch(strings.TrimSpace(macOS.TagName)); m != nil && isHTTPSURL(macOS.HTMLURL) {
			if asset, ok := assetBySuffix(*macOS, "universal.dmg"); ok {
				assets["mac-dmg"] = asset
				macInfo = &MacOSRelease{
					Tag:         macOS.TagName,
					Version:     m[1],
					PublishedAt: macOS.PublishedAt,
					PageURL:     macOS.HTMLURL,
				}
			}
		}
	}

	return Catalog{
		Tag:         release.TagName,
		Version:     version,
		Name:        release.Name,
		Channel:     "stable",
		PublishedAt: release.PublishedAt,
		PageURL:     release.HTMLURL,
		Assets:      assets,
		MacOS:       macInfo,
	}, nil
}

var macOSTagRelease = regexp.MustCompile(`^macos-v(\d+\.\d+\.\d+)$`)

// Por sufixo, não por nome exato: a versão está no nome do artefato.
func assetBySuffix(release gh.Release, suffix string) (Asset, bool) {
	for _, asset := range release.Assets {
		if asset.Name != "" && strings.HasSuffix(asset.Name, suffix) && isHTTPSURL(asset.BrowserDownloadURL) {
			return Asset{Name: asset.Name, URL: asset.BrowserDownloadURL}, true
		}
	}
	return Asset{}, false
}

func isHTTPSURL(raw string) bool {
	u, err := url.Parse(strings.TrimSpace(raw))
	return err == nil && u.Scheme == "https" && u.Host != ""
}

func (c *CatalogCache) snapshotFresh() (Catalog, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	if c.catalog == nil || !c.now().Before(c.expiresAt) {
		return Catalog{}, false
	}
	return cloneCatalog(*c.catalog), true
}

func (c *CatalogCache) snapshot() (Catalog, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	if c.catalog == nil {
		return Catalog{}, false
	}
	return cloneCatalog(*c.catalog), true
}

func cloneCatalog(in Catalog) Catalog {
	out := in
	if in.MacOS != nil {
		mac := *in.MacOS
		out.MacOS = &mac
	}
	out.Assets = make(map[string]Asset, len(in.Assets))
	for alias, asset := range in.Assets {
		out.Assets[alias] = asset
	}
	return out
}
