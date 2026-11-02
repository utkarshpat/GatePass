export type RequestLimits = {
  maxInFlight?: number;
  maxPublicInFlight?: number;
  publicRequestsPerMinute?: number;
  maximumSources?: number;
};
type Admission = { allowed: false; retryAfter: number } | { allowed: true; release(): void };

/** Process-local admission, before body parsing/provider/SQL work. It is not a
 * distributed edge limiter. Only a keyed socket-peer digest is retained. */
export class RequestAdmission {
  #active = 0;
  #publicActive = 0;
  #authActive = 0;
  #sources = new Map<string, { started: number; requests: number }>();
  #cleanupAt = 0;
  #limits: Required<RequestLimits>;
  #now: () => number;
  constructor(limits: RequestLimits = {}, now = Date.now) {
    const maxInFlight = limits.maxInFlight ?? 32;
    this.#limits = { maxInFlight, maxPublicInFlight: limits.maxPublicInFlight ?? Math.min(8, Math.max(1, maxInFlight - 1)), publicRequestsPerMinute: limits.publicRequestsPerMinute ?? 300, maximumSources: limits.maximumSources ?? 4096 };
    for (const [key, maximum] of Object.entries({ maxInFlight: 128, maxPublicInFlight: 128, publicRequestsPerMinute: 6000, maximumSources: 65536 })) {
      const value = this.#limits[key as keyof RequestLimits];
      if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw Error('INVALID_REQUEST_LIMITS');
    }
    if (this.#limits.maxPublicInFlight > maxInFlight || maxInFlight > 1 && this.#limits.maxPublicInFlight === maxInFlight) throw Error('INVALID_REQUEST_LIMITS');
    this.#now = now;
  }
  enter(source: string, isPublic: boolean): Admission {
    if (!/^[a-f0-9]{64}$/u.test(source)) throw Error('INVALID_REQUEST_SOURCE');
    if (this.#active >= this.#limits.maxInFlight || isPublic && this.#publicActive >= this.#limits.maxPublicInFlight) return { allowed: false, retryAfter: 1 };
    if (isPublic) {
      const now = this.#now();
      if (now >= this.#cleanupAt) {
        for (const [key, value] of this.#sources) if (now - value.started >= 60000) this.#sources.delete(key);
        this.#cleanupAt = now + 1000;
      }
      let bucket = this.#sources.get(source);
      if (bucket && now - bucket.started >= 60000) { this.#sources.delete(source); bucket = undefined; }
      if (!bucket) {
        if (this.#sources.size >= this.#limits.maximumSources) return { allowed: false, retryAfter: 60 };
        bucket = { started: now, requests: 0 }; this.#sources.set(source, bucket);
      }
      if (bucket.requests >= this.#limits.publicRequestsPerMinute) return { allowed: false, retryAfter: Math.max(1, Math.ceil((bucket.started + 60000 - now) / 1000)) };
      bucket.requests++;
    }
    this.#active++; if (isPublic) this.#publicActive++;
    let released = false;
    return { allowed: true, release: () => { if (released) return; released = true; this.#active--; if (isPublic) this.#publicActive--; } };
  }
  /** Verify credentials without reading a caller-controlled body or granting
   * protected capacity. Checks share the total ceiling but have their own small
   * ceiling, independent of slow public bodies. Do not release a pending check
   * merely because its caller disconnects. */
  authenticate(): Admission {
    if (this.#active >= this.#limits.maxInFlight || this.#authActive >= this.#limits.maxPublicInFlight) return { allowed: false, retryAfter: 1 };
    this.#active++; this.#authActive++;
    let released = false;
    return { allowed: true, release: () => { if (released) return; released = true; this.#active--; this.#authActive--; } };
  }
}
export const publicRequestPath = (path: string) => path.startsWith('/api/registration/') || path.startsWith('/api/email/external/') || ['/api/auth/login','/api/auth/setup','/api/staff/login','/api/staff/setup','/api/dev/sso/login'].includes(path);
