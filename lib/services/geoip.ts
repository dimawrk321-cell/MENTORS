import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

// Spec 7.2 + changelog: GeoIP is an optional adapter over a local MaxMind mmdb
// file. No GEOIP_DB_PATH (or an unreadable file) → every lookup returns null,
// sessions keep city=null and geo flags are silently skipped. The platform
// never downloads databases itself.

export interface GeoPoint {
  city: string | null;
  country: string | null;
  latitude: number;
  longitude: number;
}

interface MmdbCityRecord {
  city?: { names?: { ru?: string; en?: string } };
  country?: { iso_code?: string };
  location?: { latitude?: number; longitude?: number };
}

interface MmdbReader {
  get(ip: string): MmdbCityRecord | null;
}

let readerPromise: Promise<MmdbReader | null> | null = null;

function loadReader(): Promise<MmdbReader | null> {
  readerPromise ??= (async () => {
    const dbPath = env.geoipDbPath;
    if (!dbPath) return null;
    try {
      // Lazy import: the reader (and its file mmap) loads only when configured.
      const maxmind = await import("maxmind");
      return (await maxmind.open(dbPath)) as unknown as MmdbReader;
    } catch (error) {
      logger.warn(
        { err: error, dbPath },
        "GeoIP database is configured but failed to load — lookups disabled",
      );
      return null;
    }
  })();
  return readerPromise;
}

function isPrivateIp(ip: string): boolean {
  return (
    ip === "127.0.0.1" ||
    ip === "::1" ||
    ip.startsWith("10.") ||
    ip.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ||
    ip.startsWith("fc") ||
    ip.startsWith("fe80")
  );
}

export async function lookupIp(ip: string): Promise<GeoPoint | null> {
  if (!ip || isPrivateIp(ip)) return null;
  const reader = await loadReader();
  if (!reader) return null;
  try {
    const record = reader.get(ip);
    const location = record?.location;
    if (!location || location.latitude === undefined || location.longitude === undefined) {
      return null;
    }
    return {
      city: record?.city?.names?.ru ?? record?.city?.names?.en ?? null,
      country: record?.country?.iso_code ?? null,
      latitude: location.latitude,
      longitude: location.longitude,
    };
  } catch {
    return null;
  }
}

/** Great-circle distance (haversine), km. */
export function distanceKm(
  a: Pick<GeoPoint, "latitude" | "longitude">,
  b: Pick<GeoPoint, "latitude" | "longitude">,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * earthRadiusKm * Math.asin(Math.sqrt(h));
}
