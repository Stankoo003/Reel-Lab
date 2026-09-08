package dev.reellab.server.web;

import dev.reellab.server.persistence.entity.ConversationEntity;
import dev.reellab.server.persistence.entity.ConversationReadEntity;
import dev.reellab.server.persistence.entity.MessageEntity;
import dev.reellab.server.persistence.entity.UserEntity;
import dev.reellab.server.service.BlockService;
import dev.reellab.server.service.ConversationService;
import dev.reellab.server.service.MessageService;
import dev.reellab.server.web.dto.ConversationResponse;
import dev.reellab.server.web.dto.MessagePageResponse;
import dev.reellab.server.web.dto.MessageResponseDto;
import dev.reellab.server.web.dto.OpenConversationRequest;
import dev.reellab.server.web.dto.ReceiptResponse;
import dev.reellab.server.web.dto.SendMessageRequest;
import dev.reellab.server.web.dto.UserSummaryResponse;
import jakarta.validation.Valid;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Conversations and their messages, over HTTP.
 *
 * <p>The socket delivers live updates; history and sending both live here. That split is
 * deliberate: a message sent over HTTP can be retried by a client that was offline, and its
 * success or failure is a status code rather than a frame that may or may not have arrived.
 * The socket then carries the same message to whoever is listening.
 */
@RestController
@RequestMapping("/api/conversations")
public class ConversationController {

    private final ConversationService conversations;
    private final MessageService messages;
    private final BlockService blocks;
    private final MessageBroadcaster broadcaster;
    private final MediaUrlAssembler media;

    public ConversationController(ConversationService conversations, MessageService messages,
                                  BlockService blocks, MessageBroadcaster broadcaster,
                                  MediaUrlAssembler media) {
        this.conversations = conversations;
        this.messages = messages;
        this.blocks = blocks;
        this.broadcaster = broadcaster;
        this.media = media;
    }

    @GetMapping
    public List<ConversationResponse> list(@AuthenticationPrincipal Jwt jwt) {
        UUID viewerId = CurrentUser.id(jwt);
        List<ConversationEntity> threads = conversations.listFor(viewerId);
        // Last messages and unread counts for the whole list, not per row.
        MessageService.ListSummary summary =
                messages.summarise(threads.stream().map(ConversationEntity::getId).toList(), viewerId);
        return threads.stream().map(thread -> toResponse(thread, viewerId, summary)).toList();
    }

    /** Start or find the thread with one person. Refused if either has blocked the other. */
    @PostMapping
    public ConversationResponse open(@Valid @RequestBody OpenConversationRequest request,
                                     @AuthenticationPrincipal Jwt jwt) {
        UUID viewerId = CurrentUser.id(jwt);
        ConversationEntity thread = conversations.openWith(viewerId, request.userId());
        return toResponse(thread, viewerId,
                messages.summarise(List.of(thread.getId()), viewerId));
    }

    /**
     * One page of history, newest first.
     *
     * @param cursor from a previous page's {@code nextCursor}; absent for the newest page
     */
    @GetMapping("/{id}/messages")
    public MessagePageResponse page(@PathVariable UUID id,
                                    @RequestParam(required = false) String cursor,
                                    @RequestParam(required = false) Integer limit,
                                    @AuthenticationPrincipal Jwt jwt) {
        UUID viewerId = CurrentUser.id(jwt);
        PageCursor position = CursorPages.decodeOrNull(cursor);
        List<MessageEntity> page = messages.page(id, viewerId,
                CursorPages.createdAtOf(position), CursorPages.idOf(position), limit);

        // A full page means there is probably more; a short one means there is not. The
        // client also stops when a page comes back empty, so this is a hint rather than a
        // promise — and a hint that costs nothing, unlike a count(*) over the thread.
        int asked = limit == null ? page.size() : limit;
        boolean hasMore = !page.isEmpty() && page.size() >= asked;
        String nextCursor = CursorPages.nextCursor(page, hasMore,
                m -> new PageCursor(m.getCreatedAt(), m.getId()));
        return new MessagePageResponse(
                page.stream().map(m -> broadcaster.toDto(m, null)).toList(),
                nextCursor,
                hasMore,
                messages.otherReceipt(id, viewerId).map(ReceiptResponse::from).orElse(null));
    }

    /**
     * What arrived after a moment — the reconnect reconciliation.
     *
     * <p>A client whose socket dropped cannot know what it missed, because the server
     * published to a topic it was no longer listening on. Rather than hoping the stream was
     * complete, it asks.
     */
    @GetMapping("/{id}/messages/since")
    public List<MessageResponseDto> since(@PathVariable UUID id,
                                          @RequestParam Instant after,
                                          @AuthenticationPrincipal Jwt jwt) {
        return messages.since(id, CurrentUser.id(jwt), after).stream()
                .map(m -> broadcaster.toDto(m, null))
                .toList();
    }

    /**
     * Send.
     *
     * <p>Every rule lives in the service — participation, block, length, rate — so this path
     * and the socket's cannot drift into enforcing different things.
     */
    @PostMapping("/{id}/messages")
    public MessageResponseDto send(@PathVariable UUID id,
                                   @Valid @RequestBody SendMessageRequest request,
                                   @AuthenticationPrincipal Jwt jwt) {
        MessageEntity saved =
                messages.send(id, CurrentUser.id(jwt), request.body(), request.videoId());
        MessageResponseDto dto = broadcaster.toDto(saved, request.clientId());
        broadcaster.publish(saved, request.clientId());
        return dto;
    }

    /** Opening a thread reads it to the end. The other side is told: their ticks go blue. */
    @PostMapping("/{id}/read")
    public Map<String, Object> markRead(@PathVariable UUID id, @AuthenticationPrincipal Jwt jwt) {
        ConversationReadEntity row = messages.markReadNow(id, CurrentUser.id(jwt));
        broadcaster.publishReceipt(ReceiptResponse.from(row));
        return Map.of("conversationId", id, "lastReadAt", row.getLastReadAt(), "unreadCount", 0);
    }

    /**
     * The thread has reached this device — the second tick, without the thread being opened.
     *
     * <p>Sent by a client that has just received messages it is not showing: the inbox, or a
     * socket delivery to a screen that is not the thread. Opening the thread reads it, and
     * reading implies delivery, so the thread screen never needs this one.
     */
    @PostMapping("/{id}/delivered")
    public ReceiptResponse markDelivered(@PathVariable UUID id, @AuthenticationPrincipal Jwt jwt) {
        MessageService.Delivery delivery = messages.markDelivered(id, CurrentUser.id(jwt));
        ReceiptResponse receipt = ReceiptResponse.from(delivery.row());
        if (delivery.moved()) {
            broadcaster.publishReceipt(receipt);
        }
        return receipt;
    }

    /** Every thread at once — what the inbox sends after it has loaded the list. */
    @PostMapping("/delivered")
    public List<ReceiptResponse> markAllDelivered(@AuthenticationPrincipal Jwt jwt) {
        List<ReceiptResponse> receipts = messages.markAllDelivered(CurrentUser.id(jwt)).stream()
                .map(ReceiptResponse::from)
                .toList();
        receipts.forEach(broadcaster::publishReceipt);
        return receipts;
    }

    private ConversationResponse toResponse(ConversationEntity thread, UUID viewerId,
                                            MessageService.ListSummary summary) {
        UserEntity other = thread.other(viewerId);
        MessageEntity last = summary.lastOf(thread.getId());
        return new ConversationResponse(
                thread.getId(),
                new UserSummaryResponse(other.getId(), other.getUsername(), other.getDisplayName(),
                        other.getBio(), media.toUrl(other.getAvatarPath())),
                last == null ? null : broadcaster.toDto(last, null),
                summary.unreadOf(thread.getId()),
                summary.otherReceiptOf(thread.getId()) == null
                        ? null : ReceiptResponse.from(summary.otherReceiptOf(thread.getId())),
                // Shown so the composer can say why it is disabled rather than failing on
                // send. The server still refuses the send — this is the courtesy, not the rule.
                blocks.isBlockedBetween(viewerId, other.getId()),
                thread.getLastMessageAt(),
                thread.getCreatedAt());
    }
}
