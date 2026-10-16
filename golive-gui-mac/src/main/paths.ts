import * as path from 'path';

export function appDataDir(home: string): string {
  return path.join(home, 'Library', 'Application Support', 'GoLiveBypass');
}

export function configPath(home: string): string {
  return path.join(appDataDir(home), 'golive.conf');
}

export function settingsPath(home: string): string {
  return path.join(appDataDir(home), 'app-settings.json');
}

export function sessionDir(home: string): string {
  return path.join(appDataDir(home), 'proton-session');
}
