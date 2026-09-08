package dev.reellab.server;

import org.junit.jupiter.api.Test;

/**
 * The context loads at all — entities validate against the Flyway schema, every bean wires.
 *
 * <p>Extends the shared base so it reuses one Spring context and one container. Declaring its
 * own {@code @SpringBootTest} with a different annotation set forked the cache key and quietly
 * started a second Postgres, which is the opposite of what that base class documents.
 */
class ServerApplicationTests extends ApiIntegrationTest {

	@Test
	void contextLoads() {
	}

}
