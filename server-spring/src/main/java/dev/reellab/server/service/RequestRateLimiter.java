package dev.reellab.server.service;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Component;

/**
 * A sliding-window counter, keyed by whatever the caller wants to limit on.
 *
 * <p>In memory, and therefore per instance. That is a real limitation and worth stating
 * plainly: two app instances behind a load balancer each allow the full quota, so this
 * bounds abuse rather than eliminating it. The fix when it matters is the same counter in
 * Redis; the interface here does not change.
 *
 * <p>It is still worth having. The attack it blocks — thousands of reset emails aimed at one
 * address, or one host walking a list of addresses — is exactly the kind that a single
 * instance can absorb and that costs a real person a flooded inbox.
 */
@Component
public class RequestRateLimiter {

    private final Map<String, Deque<Instant>> hits = new ConcurrentHashMap<>();

    /**
     * Records one attempt and says whether it is allowed.
     *
     * @return true when the attempt is within the limit, false when it should be refused
     */
    public boolean tryAcquire(String key, int limit, Duration window) {
        Instant now = Instant.now();
        Instant cutoff = now.minus(window);

        // Synchronised on the per-key deque, not on the map: two different keys never
        // contend, and the same key must not race itself into allowing limit+1.
        Deque<Instant> timestamps = hits.computeIfAbsent(key, k -> new ArrayDeque<>());
        synchronized (timestamps) {
            while (!timestamps.isEmpty() && timestamps.peekFirst().isBefore(cutoff)) {
                timestamps.pollFirst();
            }
            if (timestamps.size() >= limit) {
                return false;
            }
            timestamps.addLast(now);
            return true;
        }
    }

    /**
     * Drops keys whose window has fully passed.
     *
     * <p>Without this the map grows once per distinct email and IP ever seen, which for an
     * endpoint anyone can call unauthenticated is a slow memory leak with a stranger's hand
     * on the tap. Called on a schedule; see PasswordResetService.
     */
    public void evictOlderThan(Duration window) {
        Instant cutoff = Instant.now().minus(window);
        hits.forEach((key, timestamps) -> {
            synchronized (timestamps) {
                while (!timestamps.isEmpty() && timestamps.peekFirst().isBefore(cutoff)) {
                    timestamps.pollFirst();
                }
                if (timestamps.isEmpty()) {
                    hits.remove(key, timestamps);
                }
            }
        });
    }

    /** Test seam — lets a test start from a known state rather than from the last test's. */
    public void clear() {
        hits.clear();
    }
}
