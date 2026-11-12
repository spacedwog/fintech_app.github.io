package com.spacecworp.fintechapi.leads;

import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;
import org.springframework.stereotype.Component;

@Component
public class LeadRateLimiter {
    private static final int MAX_REQUESTS = 5;
    private static final int MAX_TRACKED_ADDRESSES = 10_000;
    private static final Duration WINDOW = Duration.ofHours(1);
    private final Map<String, Bucket> buckets = new HashMap<>();

    public synchronized boolean allow(String address) {
        Instant now = Instant.now();
        Iterator<Map.Entry<String, Bucket>> iterator = buckets.entrySet().iterator();
        while (iterator.hasNext()) {
            if (iterator.next().getValue().startedAt().plus(WINDOW).isBefore(now)) iterator.remove();
        }

        String key = address == null || address.isBlank() ? "unknown" : address;
        Bucket bucket = buckets.get(key);
        if (bucket == null) {
            if (buckets.size() >= MAX_TRACKED_ADDRESSES) return false;
            buckets.put(key, new Bucket(now, 1));
            return true;
        }
        if (bucket.startedAt().plus(WINDOW).isBefore(now) || bucket.startedAt().plus(WINDOW).equals(now)) {
            buckets.put(key, new Bucket(now, 1));
            return true;
        }
        if (bucket.count() >= MAX_REQUESTS) return false;
        buckets.put(key, new Bucket(bucket.startedAt(), bucket.count() + 1));
        return true;
    }

    private record Bucket(Instant startedAt, int count) {}
}
