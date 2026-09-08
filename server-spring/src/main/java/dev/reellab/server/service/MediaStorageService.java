package dev.reellab.server.service;

import dev.reellab.server.config.MediaStorageProperties;
import dev.reellab.server.service.exception.ValidationException;
import java.io.ByteArrayInputStream;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.SequenceInputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.Arrays;
import java.util.Locale;
import java.util.UUID;
import org.springframework.stereotype.Service;

/**
 * Writes uploaded media to disk and returns the RELATIVE paths that go in the database.
 *
 * <p>Deliberately knows nothing about HTTP or multipart — it takes a stream and a
 * content type, so the same service backs an object-storage implementation later.
 */
@Service
public class MediaStorageService {

    public enum Kind {
        VIDEO,
        POSTER,
        AVATAR
    }

    /**
     * Avatars are capped far below the media limit and separately from it. A profile picture
     * that arrives as a 200MB video is not a large avatar, it is the wrong thing.
     *
     * <p>This bounds what is KEPT, not what is received: Tomcat has already spooled the whole
     * multipart to java.io.tmpdir by the time any of this runs, bounded only by
     * spring.servlet.multipart.max-file-size. Lowering that is the only way to bound the
     * receive, and it is shared with video uploads.
     */
    private static final long AVATAR_MAX_BYTES = 512 * 1024;

    /**
     * The first bytes of each format we accept, checked against the actual upload.
     *
     * <p>The declared Content-Type is written by the client and can say anything, so on its
     * own it validates nothing — "image/png" on an executable is a one-line change for a
     * caller. These are what the bytes have to be.
     */
    private static final byte[] JPEG_MAGIC = {(byte) 0xFF, (byte) 0xD8, (byte) 0xFF};
    private static final byte[] PNG_MAGIC =
            {(byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A};
    private static final byte[] RIFF_MAGIC = {'R', 'I', 'F', 'F'};
    private static final byte[] WEBP_MAGIC = {'W', 'E', 'B', 'P'};

    private final Path root;
    private final long maxBytes;

    public MediaStorageService(MediaStorageProperties properties) {
        this.root = Path.of(properties.directory()).toAbsolutePath().normalize();
        this.maxBytes = properties.maxBytes();
    }

    /**
     * @return a relative path, never absolute and never a URL
     */
    public String store(InputStream stream, String contentType, Kind kind) {
        // The client's filename is never used: it is attacker-controlled and a path
        // traversal risk. Every upload gets a server-generated id instead.
        String id = UUID.randomUUID().toString();

        return switch (kind) {
            case VIDEO -> {
                String ext = extensionFor(contentType, "video/");
                yield write(stream, "videos/uploads/" + id + "/clip." + ext, maxBytes);
            }
            case POSTER -> {
                String ext = extensionFor(contentType, "image/");
                yield write(stream, "posters/uploads/" + id + "." + ext, maxBytes);
            }
            case AVATAR -> {
                // Declared type first, because it gives the better message; then the bytes,
                // because they are the ones that decide.
                String ext = extensionFor(contentType, "image/");
                InputStream verified = requireImageBytes(stream);
                yield write(verified, "avatars/" + id + "." + ext, AVATAR_MAX_BYTES);
            }
        };
    }

    private String write(InputStream in, String relativePath, long limit) {
        Path target = root.resolve(relativePath).normalize();
        if (!target.startsWith(root)) {
            throw new ValidationException("Resolved path escapes the media directory");
        }
        try {
            Files.createDirectories(target.getParent());
            // Bounded on the way in, not measured afterwards. Copying first and checking the
            // size after means a caller can make the server write a file of any size before
            // it is rejected — the disk is full either way.
            try (InputStream bounded = new BoundedInputStream(in, limit)) {
                Files.copy(bounded, target, StandardCopyOption.REPLACE_EXISTING);
            } catch (UploadTooLargeException tooLarge) {
                Files.deleteIfExists(target);
                throw new ValidationException(
                        "Upload exceeds the " + limit + " byte limit for this kind of file");
            }
            return relativePath;
        } catch (IOException e) {
            throw new IllegalStateException("Could not store " + relativePath, e);
        }
    }

    /**
     * Confirms the upload actually starts with an image header, and hands back a stream with
     * those bytes put back so the file can still be written whole.
     */
    private InputStream requireImageBytes(InputStream in) {
        byte[] head = new byte[12];
        int read;
        try {
            read = in.readNBytes(head, 0, head.length);
        } catch (IOException e) {
            throw new IllegalStateException("Could not read upload", e);
        }
        if (!looksLikeImage(head, read)) {
            throw new ValidationException(
                    "An avatar must be a JPEG, PNG or WebP image; the uploaded bytes are not one");
        }
        return new SequenceInputStream(new ByteArrayInputStream(head, 0, read), in);
    }

    private boolean looksLikeImage(byte[] head, int length) {
        if (startsWith(head, length, JPEG_MAGIC) || startsWith(head, length, PNG_MAGIC)) {
            return true;
        }
        // WebP is "RIFF", a four-byte length, then "WEBP".
        return length >= 12
                && startsWith(head, length, RIFF_MAGIC)
                && Arrays.equals(head, 8, 12, WEBP_MAGIC, 0, 4);
    }

    private boolean startsWith(byte[] head, int length, byte[] magic) {
        return length >= magic.length && Arrays.equals(head, 0, magic.length, magic, 0, magic.length);
    }

    /** Signals the cap was hit; unwrapped by {@link #write} into a ValidationException. */
    private static final class UploadTooLargeException extends IOException {
    }

    /** Fails the copy as soon as one byte past the limit appears, rather than at the end. */
    private static final class BoundedInputStream extends FilterInputStream {

        private final long limit;
        private long seen;

        BoundedInputStream(InputStream in, long limit) {
            super(in);
            this.limit = limit;
        }

        @Override
        public int read() throws IOException {
            int b = super.read();
            if (b != -1) {
                count(1);
            }
            return b;
        }

        @Override
        public int read(byte[] buffer, int off, int len) throws IOException {
            int n = super.read(buffer, off, len);
            if (n > 0) {
                count(n);
            }
            return n;
        }

        private void count(long n) throws IOException {
            seen += n;
            if (seen > limit) {
                throw new UploadTooLargeException();
            }
        }
    }

    /**
     * The extension for a declared content type, or a rejection.
     *
     * <p>Deliberately an allowlist with no fallback. It previously returned a default for an
     * absent header — before the prefix check ran, so omitting Content-Type skipped validation
     * entirely — and for any unrecognised type, which stored {@code image/svg+xml} as
     * {@code .jpg}. An SVG is a script container, and the default {@code cdn-base-url} is the
     * API's own origin, so that combination is stored XSS.
     */
    private String extensionFor(String contentType, String expectedPrefix) {
        String type = contentType == null
                ? ""
                : contentType.toLowerCase(Locale.ROOT).split(";")[0].trim();
        String extension = switch (type) {
            case "video/mp4" -> "mp4";
            case "video/quicktime" -> "mov";
            case "image/jpeg", "image/jpg" -> "jpg";
            case "image/png" -> "png";
            case "image/webp" -> "webp";
            default -> null;
        };
        if (extension == null || !type.startsWith(expectedPrefix)) {
            throw new ValidationException("Expected a supported " + expectedPrefix
                    + "* type but got " + (type.isEmpty() ? "no content type" : type));
        }
        return extension;
    }
}
