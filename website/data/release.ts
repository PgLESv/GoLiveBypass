export type ReleaseAlias =
  | 'windows'
  | 'linux'
  | 'mac-dmg'
  | 'plugin'
  | 'plugin-sha'
  | 'standalone'
  | 'standalone-sha'

export type ReleaseAssetKey =
  | 'windowsGui'
  | 'macDmg'
  | 'linuxGui'
  | 'plugin'
  | 'pluginSha'
  | 'standaloneJs'
  | 'standaloneSha'

export type ReleaseStatus = 'fallback' | 'loading' | 'ready' | 'stale' | 'error'

export interface ReleaseAsset {
  name: string
  url: string
}

export interface MacOSRelease {
  tag: string
  version: string
  publishedAt: string
  pageUrl: string
}

export interface ReleaseCatalog {
  tag: string
  version: string
  name: string
  channel: 'stable'
  publishedAt: string
  pageUrl: string
  stale: boolean
  assets: Partial<Record<ReleaseAlias, ReleaseAsset>>
  macos?: MacOSRelease
}

const owner = 'PgLESv'
const repo = 'GoLiveBypass'
const fallbackTag = 'v2.1.10'
const fallbackVersion = '2.1.10'
// O cliente macOS é outra aplicação, com release própria (macos-vX.Y.Z) e
// make_latest=false: ele não aparece na estável da GUI. O fallback do site
// precisa apontar para essa tag, senão oferece um arquivo que não existe.
const macReleaseTag = 'macos-v0.7.0'
const macReleaseVersion = '0.7.0'
const macDmgAssetName = `GoLiveBypass-macos-${macReleaseVersion}-universal.dmg`
const repositoryUrl = `https://github.com/${owner}/${repo}`

export const release = {
  owner,
  repo,
  tag: fallbackTag,
  version: fallbackVersion,
  channel: 'stable',
  assets: {
    windowsGui: `GoLiveBypass-${fallbackVersion}.exe`,
    macDmg: macDmgAssetName,
    linuxGui: `GoLiveBypass-${fallbackVersion}.AppImage`,
    plugin: 'goLiveBypass-vencord.zip',
    pluginSha: 'goLiveBypass-vencord.zip.sha256',
    standaloneJs: `GoLiveBypass-${fallbackVersion}-bypass.js`,
    standaloneSha: `GoLiveBypass-${fallbackVersion}-bypass.js.sha256`,
  } satisfies Record<ReleaseAssetKey, string>,
} as const

export const macRelease = {
  tag: macReleaseTag,
  version: macReleaseVersion,
  pageUrl: `${repositoryUrl}/releases/tag/${macReleaseTag}`,
} as const

export const githubRepositoryUrl = repositoryUrl
export const githubReleasePageUrl = `${repositoryUrl}/releases/tag/${release.tag}`

export function githubReleaseAssetUrl(asset: string, tag: string = release.tag) {
  return `${repositoryUrl}/releases/download/${tag}/${encodeURIComponent(asset)}`
}

export { macDmgAssetName, macReleaseTag, macReleaseVersion }

export function githubRawUrl(path: string) {
  const encodedPath = path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')

  return `https://raw.githubusercontent.com/${owner}/${repo}/main/${encodedPath}`
}

export function releaseApiCatalogUrl(apiBaseUrl: string) {
  return `${apiBaseUrl.replace(/\/$/, '')}/v1/releases/latest`
}

export function releaseApiDownloadUrl(apiBaseUrl: string, alias: ReleaseAlias) {
  return `${apiBaseUrl.replace(/\/$/, '')}/v1/releases/latest/download/${encodeURIComponent(alias)}`
}

const fallbackAssets: Record<ReleaseAlias, ReleaseAsset> = {
  windows: { name: release.assets.windowsGui, url: githubReleaseAssetUrl(release.assets.windowsGui) },
  linux: { name: release.assets.linuxGui, url: githubReleaseAssetUrl(release.assets.linuxGui) },
  'mac-dmg': { name: macDmgAssetName, url: githubReleaseAssetUrl(macDmgAssetName, macReleaseTag) },
  plugin: { name: release.assets.plugin, url: githubReleaseAssetUrl(release.assets.plugin) },
  'plugin-sha': { name: release.assets.pluginSha, url: githubReleaseAssetUrl(release.assets.pluginSha) },
  standalone: { name: release.assets.standaloneJs, url: githubReleaseAssetUrl(release.assets.standaloneJs) },
  'standalone-sha': { name: release.assets.standaloneSha, url: githubReleaseAssetUrl(release.assets.standaloneSha) },
}

export const fallbackReleaseCatalog: ReleaseCatalog = {
  tag: release.tag,
  version: release.version,
  name: `GoLiveBypass ${release.version}`,
  channel: 'stable',
  publishedAt: '',
  pageUrl: githubReleasePageUrl,
  stale: false,
  macos: {
    tag: macRelease.tag,
    version: macRelease.version,
    publishedAt: '',
    pageUrl: macRelease.pageUrl,
  },
  assets: fallbackAssets,
}

export const downloads = {
  windowsGui: fallbackAssets.windows.url,
  macDmg: fallbackAssets['mac-dmg'].url,
  linuxGui: fallbackAssets.linux.url,
  plugin: fallbackAssets.plugin.url,
  pluginSha: fallbackAssets['plugin-sha'].url,
  standaloneJs: fallbackAssets.standalone.url,
  standaloneSha: fallbackAssets['standalone-sha'].url,
  installerWindows: githubRawUrl('installer/GoLiveBypass-Installer.ps1'),
  installerPosix: githubRawUrl('installer/golivebypass-installer.sh'),
  standaloneWindows: githubRawUrl('standalone/GoLiveBypass-Standalone.ps1'),
  standaloneWindowsBat: githubRawUrl('standalone/GoLiveBypass-Standalone.bat'),
  standalonePosix: githubRawUrl('standalone/golivebypass-standalone.sh'),
}

const semver = /^\d+\.\d+\.\d+$/
const aliases: ReleaseAlias[] = ['windows', 'linux', 'mac-dmg', 'plugin', 'plugin-sha', 'standalone', 'standalone-sha']

export function parseReleaseCatalog(input: unknown): ReleaseCatalog | null {
  if (!input || typeof input !== 'object') return null
  const data = input as Record<string, unknown>
  if (data.channel !== 'stable' || typeof data.version !== 'string' || !semver.test(data.version)) return null
  if (typeof data.tag !== 'string' || !/^v?\d+\.\d+\.\d+$/.test(data.tag)) return null
  if (typeof data.page_url !== 'string' || !isHttpsUrl(data.page_url)) return null
  if (typeof data.name !== 'string' || typeof data.published_at !== 'string') return null

  const rawAssets = data.assets
  const parsedAssets: Partial<Record<ReleaseAlias, ReleaseAsset>> = {}
  if (rawAssets && typeof rawAssets === 'object') {
    for (const alias of aliases) {
      const rawAsset = (rawAssets as Record<string, unknown>)[alias]
      if (!rawAsset || typeof rawAsset !== 'object') continue
      const asset = rawAsset as Record<string, unknown>
      if (typeof asset.name === 'string' && typeof asset.url === 'string' && isHttpsUrl(asset.url)) {
        parsedAssets[alias] = { name: asset.name, url: asset.url }
      }
    }
  }

  const rawMacOS = data.macos
  let macOS: MacOSRelease | undefined
  if (rawMacOS && typeof rawMacOS === 'object') {
    const m = rawMacOS as Record<string, unknown>
    if (typeof m.tag === 'string' && /^macos-v?\d+\.\d+\.\d+$/.test(m.tag)
      && typeof m.version === 'string' && semver.test(m.version)
      && typeof m.published_at === 'string'
      && typeof m.page_url === 'string' && isHttpsUrl(m.page_url)) {
      macOS = { tag: m.tag, version: m.version, publishedAt: m.published_at, pageUrl: m.page_url }
    }
  }

  return {
    tag: data.tag,
    version: data.version,
    name: data.name,
    channel: 'stable',
    publishedAt: data.published_at,
    pageUrl: data.page_url,
    stale: data.stale === true,
    assets: parsedAssets,
    macos: macOS,
  }
}

function isHttpsUrl(value: string) {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}
