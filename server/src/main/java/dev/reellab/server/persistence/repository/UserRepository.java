package dev.reellab.server.persistence.repository;

import dev.reellab.server.persistence.entity.UserEntity;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface UserRepository extends JpaRepository<UserEntity, UUID> {

    boolean existsByUsernameIgnoreCase(String username);

    boolean existsByEmailIgnoreCase(String email);

    /**
     * Case-insensitive because the uniqueness it looks up is: `users_email_key` is a
     * functional index on `lower(email)`, so `Marko@x.com` and `marko@x.com` cannot both
     * exist. A case-sensitive lookup would refuse the login of an account that does.
     */
    Optional<UserEntity> findByEmailIgnoreCase(String email);
}
