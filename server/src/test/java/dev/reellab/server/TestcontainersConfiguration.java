package dev.reellab.server;

import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.annotation.Bean;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

/**
 * The database every integration test runs against.
 *
 * <p>Postgres, not H2: the schema uses {@code gen_random_uuid()}, regex check constraints and
 * a partial index, so an in-memory substitute would test a different database than the one we
 * deploy. {@code @ServiceConnection} supplies the datasource url, user and password, which is
 * why no {@code application-test.yml} is needed.
 *
 * <p>Spring's test context is cached across test classes, so the container starts once per
 * build rather than once per class.
 */
@TestConfiguration(proxyBeanMethods = false)
public class TestcontainersConfiguration {

    @Bean
    @ServiceConnection
    PostgreSQLContainer<?> postgresContainer() {
        return new PostgreSQLContainer<>(DockerImageName.parse("postgres:17-alpine"));
    }
}
