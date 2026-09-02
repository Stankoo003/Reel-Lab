package dev.reellab.server.web.dto;

/** Relative path of one uploaded file, ready to pass to POST /api/videos. */
public record UploadMediaResponse(String path) {
}
