package gh

import (
	"regexp"
	"strconv"
	"strings"
)

// O cliente macOS tem tag própria (macos-vX.Y.Z) e é publicado com
// make_latest=false, então NUNCA aparece em /releases/latest: para o catálogo
// oferecê-lo é preciso varrer a lista de releases.
var macOSTag = regexp.MustCompile(`^macos-v(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$`)

type macVersion [3]int

func parseMacVersion(tag string) (macVersion, bool) {
	m := macOSTag.FindStringSubmatch(strings.TrimSpace(tag))
	if m == nil {
		return macVersion{}, false
	}
	var v macVersion
	for i := range v {
		n, err := strconv.Atoi(m[i+1])
		if err != nil {
			return macVersion{}, false
		}
		v[i] = n
	}
	return v, true
}

// after informa se a é maior que b, comparando major, minor e patch.
func (a macVersion) after(b macVersion) bool {
	for i := range a {
		if a[i] != b[i] {
			return a[i] > b[i]
		}
	}
	return false
}

// LatestMacOSRelease devolve a maior release do cliente macOS. Drafts e
// prereleases ficam de fora: a página de downloads não pode oferecer beta como
// se fosse a versão atual, e o updater do app também ignora prerelease.
func LatestMacOSRelease(releases []Release) (Release, bool) {
	var best Release
	var bestVersion macVersion
	for _, release := range releases {
		if release.Draft || release.Prerelease {
			continue
		}
		version, ok := parseMacVersion(release.TagName)
		if !ok {
			continue
		}
		if best.TagName != "" && !version.after(bestVersion) {
			continue
		}
		best, bestVersion = release, version
	}
	return best, best.TagName != ""
}
