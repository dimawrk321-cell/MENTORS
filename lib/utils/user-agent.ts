// Tiny UA classifier — enough for a human-readable device label («Chrome · macOS»)
// and a stable platform component of the device fingerprint (spec 7.2).

interface ParsedUserAgent {
  browser: string;
  os: string;
  /** Human label stored on devices, e.g. «Chrome · macOS». */
  label: string;
  /** Stable part of the fingerprint: survives browser version bumps. */
  platformKey: string;
}

function detectBrowser(ua: string): string {
  if (/YaBrowser\//.test(ua)) return "Яндекс Браузер";
  if (/Edg(e|A|iOS)?\//.test(ua)) return "Edge";
  if (/OPR\/|Opera/.test(ua)) return "Opera";
  if (/Firefox\/|FxiOS\//.test(ua)) return "Firefox";
  if (/CriOS\//.test(ua)) return "Chrome";
  if (/Chrome\//.test(ua)) return "Chrome";
  if (/Safari\//.test(ua)) return "Safari";
  return "Браузер";
}

function detectOs(ua: string): string {
  if (/iPhone|iPad|iPod/.test(ua)) return "iOS";
  if (/Android/.test(ua)) return "Android";
  if (/Windows/.test(ua)) return "Windows";
  if (/Mac OS X|Macintosh/.test(ua)) return "macOS";
  if (/Linux/.test(ua)) return "Linux";
  return "Устройство";
}

export function parseUserAgent(userAgent: string | null | undefined): ParsedUserAgent {
  const ua = userAgent ?? "";
  const browser = detectBrowser(ua);
  const os = detectOs(ua);
  return { browser, os, label: `${browser} · ${os}`, platformKey: `${browser}|${os}` };
}
