export function protonMeasurementText(result: {
  pingMs?: number;
  downloadMbps?: number;
  uploadMbps?: number;
}): string {
  const parts: string[] = [];
  if (Number.isFinite(result.downloadMbps) && result.downloadMbps! > 0 &&
      Number.isFinite(result.uploadMbps) && result.uploadMbps! > 0) {
    parts.push(`↓ ${result.downloadMbps!.toFixed(1)} / ↑ ${result.uploadMbps!.toFixed(1)} Mbps medidos`);
  }
  if (Number.isFinite(result.pingMs) && result.pingMs! > 0) parts.push(`${result.pingMs} ms`);
  return parts.length ? ` (${parts.join(' · ')})` : '';
}
