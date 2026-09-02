package dev.reellab.server.web;

import dev.reellab.server.service.MediaStorageService;
import dev.reellab.server.service.exception.ValidationException;
import dev.reellab.server.web.dto.UploadMediaResponse;
import java.io.IOException;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

/**
 * Accepts the bytes, one file per request.
 *
 * <p>One-file-per-request is not arbitrary: the only multipart uploader that works on
 * React Native 0.86 (expo-file-system's native {@code File.upload}) sends exactly one
 * file per call. The JS {@code FormData} alternatives both fail — a {@code {uri,name,type}}
 * part is rejected as an "Unsupported FormDataPart implementation", and a Blob from
 * {@code File.slice()} as "Creating blobs from ArrayBuffer ... not supported".
 *
 * <p>Metadata still goes through POST /api/videos, so this endpoint stays a pure file
 * sink and the video lifecycle keeps one owner.
 */
@RestController
@RequestMapping("/api/media")
public class MediaUploadController {

    private final MediaStorageService storage;

    public MediaUploadController(MediaStorageService storage) {
        this.storage = storage;
    }

    @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public UploadMediaResponse upload(
            @RequestParam("file") MultipartFile file,
            @RequestParam("kind") String kind) {
        if (file.isEmpty()) {
            throw new ValidationException("file part is empty");
        }
        MediaStorageService.Kind parsed = switch (kind) {
            case "video" -> MediaStorageService.Kind.VIDEO;
            case "poster" -> MediaStorageService.Kind.POSTER;
            // Avatars are the one non-video upload a profile can make. The kind is what
            // selects the stricter type and size rules — see MediaStorageService.
            case "avatar" -> MediaStorageService.Kind.AVATAR;
            default -> throw new ValidationException(
                    "kind must be 'video', 'poster' or 'avatar'");
        };
        try (var stream = file.getInputStream()) {
            return new UploadMediaResponse(storage.store(stream, file.getContentType(), parsed));
        } catch (IOException e) {
            throw new IllegalStateException("Could not read upload", e);
        }
    }
}
