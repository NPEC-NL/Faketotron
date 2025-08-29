export function parseDurationToSeconds(input: unknown): number {
  if (input == null) return 0;
  if (typeof input === "number" && Number.isFinite(input)) return Math.max(0, Math.floor(input));

  const s = String(input).trim();
  if (!s) return 0;

  // Accept "D.HH:MM:SS" OR "HH:MM:SS" OR "MM:SS" OR "SS"
  let days = 0, rest = s;
  const dot = s.indexOf(".");
  if (dot > 0 && /^\d+$/.test(s.slice(0, dot))) {  // only digits before the dot = days
    days = parseInt(s.slice(0, dot), 10) || 0;
    rest = s.slice(dot + 1);
  }
  const parts = rest.split(":").map(p => p.trim());
  let h = 0, m = 0, sec = 0;

  if (parts.length === 3)      { h = +parts[0] || 0; m = +parts[1] || 0; sec = +parts[2] || 0; }
  else if (parts.length === 2) { m = +parts[0] || 0; sec = +parts[1] || 0; }
  else if (parts.length === 1) { sec = +parts[0] || 0; }
  else return 0;

  return Math.max(0, days * 86400 + h * 3600 + m * 60 + sec);
}

export function formatDurationPreserveDays(totalSec: number): string {
  const t = Math.max(0, Math.floor(totalSec || 0));
  const days = Math.floor(t / 86400);
  const rem  = t - days * 86400;
  const hh   = Math.floor(rem / 3600);
  const mm   = Math.floor((rem % 3600) / 60);
  const ss   = rem % 60;
  const hms  = `${String(hh).padStart(2,"0")}:${String(mm).padStart(2,"0")}:${String(ss).padStart(2,"0")}`;
  return days > 0 ? `${days}.${hms}` : hms;
}
