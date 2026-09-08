package dev.reellab.server.config;

import dev.reellab.server.service.RequestRateLimiter;
import java.time.Duration;
import java.util.concurrent.Executor;
import java.util.concurrent.ThreadPoolExecutor;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;

/**
 * Work that happens off the request thread.
 *
 * <p>Only two things need it: sending mail, which must not be inside the response time of an
 * endpoint whose timing is a security property, and sweeping the rate limiter's map, which
 * would otherwise grow once per distinct email and IP the server has ever seen.
 */
@Configuration
@EnableScheduling
public class BackgroundWorkConfig {

    /**
     * Ours, rather than whichever executor an auto-configuration happens to provide.
     *
     * <p>Small and bounded on purpose. The only thing on it is sending mail, and a queue
     * that grows without limit under a flood of reset requests would turn a rate-limited
     * endpoint into a memory problem — CallerRunsPolicy pushes the work back onto the
     * request thread instead, which slows the flood down rather than accumulating it.
     */
    @Bean
    Executor backgroundExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(2);
        executor.setMaxPoolSize(4);
        executor.setQueueCapacity(200);
        executor.setThreadNamePrefix("reellab-bg-");
        executor.setRejectedExecutionHandler(new ThreadPoolExecutor.CallerRunsPolicy());
        executor.initialize();
        return executor;
    }

    /**
     * A window's worth of history is all the limiter can use; anything older is only taking
     * up room. Run at a fixed rate rather than on each request so a burst does not also pay
     * for the cleanup.
     */
    @Bean
    RateLimiterSweeper rateLimiterSweeper(RequestRateLimiter limiter,
                                          PasswordResetProperties resets) {
        return new RateLimiterSweeper(limiter, resets.window());
    }

    public record RateLimiterSweeper(RequestRateLimiter limiter, Duration window) {

        @Scheduled(fixedDelayString = "PT5M")
        public void sweep() {
            limiter.evictOlderThan(window);
        }
    }
}
