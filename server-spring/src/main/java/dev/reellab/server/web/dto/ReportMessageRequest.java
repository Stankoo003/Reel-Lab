package dev.reellab.server.web.dto;

import jakarta.validation.constraints.Size;

/** @param reason optional — a report with no words is still a report */
public record ReportMessageRequest(@Size(max = 500) String reason) {
}
