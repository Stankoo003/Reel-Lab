# Build and run the API as one image.
#
# Two stages, because the build needs Maven and a JDK and the runtime needs neither. The
# result is a ~250 MB image instead of a ~700 MB one, and nothing that can compile Java
# ships to production.
#
# The dependency layer is separated deliberately: `mvn dependency:go-offline` is cached on
# the pom alone, so editing a Java file rebuilds in seconds rather than re-downloading the
# whole Spring dependency tree.

FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /build

# Dependencies first, on their own layer. Changing source does not invalidate this.
COPY pom.xml .
RUN mvn -B -q dependency:go-offline

COPY src ./src
# Tests run in CI, not here: they need a Docker daemon for Testcontainers, which a build
# container does not have.
RUN mvn -B -q clean package -DskipTests

FROM eclipse-temurin:21-jre-alpine AS runtime
WORKDIR /app

# Not root. A container that is compromised should not also be privileged inside itself.
RUN addgroup -S reellab && adduser -S reellab -G reellab

COPY --from=build /build/target/*.jar app.jar

# Where uploaded media lands. Mount a volume here, or uploads vanish on the next deploy —
# the container filesystem does not survive a restart. See MEDIA_STORAGE_DIR.
RUN mkdir -p /data/media && chown -R reellab:reellab /data
VOLUME ["/data/media"]
ENV MEDIA_STORAGE_DIR=/data/media

USER reellab
EXPOSE 8080

# Container-aware by default on modern JVMs: it reads the cgroup limit rather than the
# host's memory, so a 256 MB instance does not get a heap sized for the machine.
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75", "-jar", "app.jar"]
