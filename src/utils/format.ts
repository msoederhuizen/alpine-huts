/** "6.2 km" or "820 m" for short legs. */
export function formatDistance(metres: number): string {
  if (metres < 1000) return `${Math.round(metres)} m`;
  return `${(metres / 1000).toFixed(1)} km`;
}

/** "2h 20m", "45m", or "0m". */
export function formatDuration(seconds: number): string {
  const total = Math.round(seconds / 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m.toString().padStart(2, '0')}m`;
}

/** Rounded metres with a sign-free unit, e.g. "1088 m". */
export function formatElevation(metres: number): string {
  return `${Math.round(metres)} m`;
}
