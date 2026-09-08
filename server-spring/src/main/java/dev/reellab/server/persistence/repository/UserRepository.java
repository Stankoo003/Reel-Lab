package dev.reellab.server.persistence.repository;

import dev.reellab.server.persistence.entity.UserEntity;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface UserRepository extends JpaRepository<UserEntity, UUID> {

    boolean existsByUsernameIgnoreCase(String username);

    boolean existsByEmailIgnoreCase(String email);

    /**
     * Case-insensitive because the uniqueness it looks up is: `users_email_key` is a
     * functional index on `lower(email)`, so `Marko@x.com` and `marko@x.com` cannot both
     * exist. A case-sensitive lookup would refuse the login of an account that does.
     */
    Optional<UserEntity> findByEmailIgnoreCase(String email);

    /**
     * People matching what was typed, by handle or by display name.
     *
     * <p>Both patterns are built by {@code UserService.search} and arrive already lowercased
     * and escaped; this query lowercases the columns to meet them. {@code !} is the escape
     * character rather than the conventional backslash, because a backslash inside a JPQL
     * string literal is read differently by different providers and a search for {@code 50%}
     * must not turn into a search for everything.
     *
     * <p>The ordering is the whole reason this is a written query rather than a derived one:
     * someone typing {@code mi} wants {@code mila} before {@code marko-mihajlovic}, so a
     * match at the START of a handle sorts first, a starting display name second, and a
     * match anywhere else last. Ties break alphabetically, which also makes the result
     * stable — without a total order, paging past the first page could repeat a row.
     *
     * <p>No index serves this: {@code like '%x%'} cannot use a btree, so this is a sequential
     * scan over the users table. At this size that is the correct plan and an index would
     * only be dead weight; the upgrade path when it stops being correct is a pg_trgm GIN
     * index over the same two columns, which DOES accelerate a contains-match.
     */
    @Query("""
            select u from UserEntity u
            where lower(u.username) like :anywhere escape '!'
               or lower(u.displayName) like :anywhere escape '!'
            order by
                case
                    when lower(u.username) like :prefix escape '!' then 0
                    when lower(u.displayName) like :prefix escape '!' then 1
                    else 2
                end,
                lower(u.username)
            """)
    List<UserEntity> search(@Param("anywhere") String anywhere,
                            @Param("prefix") String prefix,
                            Pageable page);
}
