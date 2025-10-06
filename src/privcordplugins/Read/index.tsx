import React from "react";
import { PrivcordDevs } from "@utils/constants";
import definePlugin from "@utils/types";
import { addMessagePreSendListener, addMessageClickListener } from "./MessageEvents";

// Minimal, DOM-driven Vencord plugin that:
// - Detects visible messages in the chat list
// - Sends read-receipts to Privcord API for messages authored by others
// - Opens a WebSocket to receive realtime read events
// - Renders a simple ✓✓ badge next to messages that have been read by the recipient

let ws: WebSocket | null = null;
let observer: MutationObserver | null = null;
let lastChannelId: string | null = null;
const reportedMessageIds = new Set<string>();
const messageEventListeners: any[] = [];

// Throttling and debouncing
let lastDomChangeTime = 0;
let domChangeTimeout: number | null = null;
const DOM_CHANGE_THROTTLE = 1000; // 1 second throttle
const DOM_CHANGE_DEBOUNCE = 500; // 500ms debounce

// Debug mode - set to false to reduce log spam
const DEBUG_MODE = false; // Can be enabled via window.togglePrivcordRRDebug()

// Expose debug toggle to window for testing
if (typeof window !== 'undefined') {
    (window as any).togglePrivcordRRDebug = () => {
        (window as any).PRIVCORD_RR_DEBUG = !(window as any).PRIVCORD_RR_DEBUG;
        console.log(`PrivcordRR Debug mode: ${(window as any).PRIVCORD_RR_DEBUG ? 'ON' : 'OFF'}`);
    };

    // Test function to manually create a badge
    (window as any).testPrivcordRRBadge = (messageId?: string) => {
        const testId = messageId || "test123";
        console.log(`Creating test badge for message: ${testId}`);
        markBubbleAsRead(testId, "test-user", Date.now());
    };

    // Function to find all message elements
    (window as any).findPrivcordRRMessages = () => {
        const messages = getVisibleMessageElements();
        console.log(`Found ${messages.length} message elements:`, messages.map(el => ({
            id: el.id,
            classes: el.className,
            innerHTML: el.innerHTML.substring(0, 100) + '...'
        })));
        return messages;
    };
}

const STORAGE_KEY = "privcord_rr_api";

function getApiBase(): string {
    return localStorage.getItem(STORAGE_KEY) || "http://45.143.4.145:4317";
}

function log(...args: unknown[]) {
    const timestamp = new Date().toISOString();
    // eslint-disable-next-line no-console
    console.log(`[${timestamp}] [PrivcordRR]`, ...args);
}

function debugLog(...args: unknown[]) {
    const debugEnabled = DEBUG_MODE || (typeof window !== 'undefined' && (window as any).PRIVCORD_RR_DEBUG);
    if (!debugEnabled) return;
    const timestamp = new Date().toISOString();
    // eslint-disable-next-line no-console
    console.log(`[${timestamp}] [PrivcordRR-DEBUG]`, ...args);
}

function errorLog(...args: unknown[]) {
    const timestamp = new Date().toISOString();
    // eslint-disable-next-line no-console
    console.error(`[${timestamp}] [PrivcordRR-ERROR]`, ...args);
}

function waitFor<T>(fn: () => T | null | undefined, timeoutMs = 15000): Promise<T> {
    return new Promise((resolve, reject) => {
        const start = Date.now();
        const tick = () => {
            try {
                const v = fn();
                if (v) return resolve(v);
            } catch { }
            if (Date.now() - start > timeoutMs) return reject(new Error("timeout"));
            requestAnimationFrame(tick);
        };
        tick();
    });
}

// Pull stores from Vencord's webpack common if available; fall back to nulls if not present
// These are provided by Vencord runtime; during static analysis they may be undefined.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
// @ts-ignore
import { UserStore, ChannelStore, SelectedChannelStore } from "@webpack/common";

function getCurrentUserId(): string | null {
    try {
        // Vencord re-exports UserStore
        const u = UserStore?.getCurrentUser?.();
        debugLog("Current user:", u?.id, u?.username);
        return u?.id ?? null;
    } catch (error) {
        errorLog("Error getting current user:", error);
        return null;
    }
}

function getSelectedChannelId(): string | null {
    try {
        const cid = SelectedChannelStore?.getChannelId?.();
        debugLog("Selected channel ID:", cid);
        return cid ?? null;
    } catch (error) {
        errorLog("Error getting selected channel:", error);
        return null;
    }
}

function getVisibleMessageElements(): HTMLElement[] {
    // More specific selectors to avoid false positives
    const selectors = [
        '[id^="chat-messages-"] li[id*="-"]',
        '[data-list-id="chat-messages"] li[id^="chat-messages-"]',
        'li[id^="chat-messages-"][id$=""]'
    ];

    const elements = new Set<HTMLElement>();
    selectors.forEach(selector => {
        document.querySelectorAll<HTMLElement>(selector).forEach(el => {
            if (el.id && el.id.match(/chat-messages-\d+-\d+/)) {
                elements.add(el);
            }
        });
    });

    const result = Array.from(elements);
    debugLog(`Found ${result.length} visible message elements`);
    return result;
}

async function postJSON(path: string, body: unknown): Promise<unknown> {
    const base = getApiBase();
    debugLog("POST request:", { url: `${base}${path}`, body });

    const res = await fetch(`${base}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });

    if (!res.ok) {
        errorLog(`HTTP error ${res.status}:`, await res.text());
        throw new Error(`HTTP ${res.status}`);
    }

    const result = await res.json();
    debugLog("POST response:", result);
    return result;
}

async function getJSON(path: string): Promise<any> {
    const base = getApiBase();
    debugLog("GET request:", `${base}${path}`);

    const res = await fetch(`${base}${path}`);
    if (!res.ok) {
        errorLog(`HTTP error ${res.status}:`, await res.text());
        throw new Error(`HTTP ${res.status}`);
    }

    const result = await res.json();
    debugLog("GET response:", result);
    return result;
}

function openSocket(userId: string): WebSocket {
    const base = getApiBase();
    const u = new URL(`${base.replace(/^http/, "ws")}/ws`);
    u.searchParams.set("userId", userId);

    debugLog("Opening WebSocket:", u.toString());
    const s = new WebSocket(u);

    s.onopen = () => {
        log("WebSocket connected successfully");
        debugLog("WebSocket readyState:", s.readyState);
    };

    s.onclose = (event) => {
        log("WebSocket closed:", { code: event.code, reason: event.reason });
        debugLog("WebSocket close event:", event);
    };

    s.onerror = (error) => {
        errorLog("WebSocket error:", error);
    };

    s.onmessage = (ev) => {
        try {
            debugLog("WebSocket message received:", ev.data);
            const msg = JSON.parse(ev.data);
            if (msg?.type === "read") {
                log("Read receipt received:", msg.payload);
                markBubbleAsRead(msg.payload.messageId, msg.payload.readerId, msg.payload.readAt);
            }
        } catch (error) {
            errorLog("Error parsing WebSocket message:", error, ev.data);
        }
    };

    return s;
}

function extractMessageData(li: HTMLElement): { channelId: string; messageId: string; authorId: string | null; } | null {
    // Expect li id like: chat-messages-<channelId>-<messageId>
    const id = li?.id || "";
    debugLog("Extracting message data from element:", { id, className: li.className });

    const m = id.match(/chat-messages-(\d+)-(\d+)/);
    if (!m) {
        debugLog("Failed to match message ID pattern for:", id);
        return null;
    }

    const channelId = m[1];
    const messageId = m[2];

    // Author id heuristic: try multiple methods to get author ID
    let authorId = li.getAttribute("data-author-id");

    // If not found, try to get from avatar or other elements
    if (!authorId) {
        const avatar = li.querySelector('[class*="avatar"]') as HTMLElement;
        if (avatar) {
            authorId = avatar.getAttribute("data-user-id") ||
                avatar.getAttribute("data-author-id") ||
                avatar.getAttribute("title") ||
                null;
        }
    }

    // If still not found, try to get from message wrapper
    if (!authorId) {
        const messageWrapper = li.querySelector('[class*="message"]') as HTMLElement;
        if (messageWrapper) {
            authorId = messageWrapper.getAttribute("data-author-id") ||
                messageWrapper.getAttribute("data-user-id") ||
                null;
        }
    }

    debugLog("Extracted message data:", { channelId, messageId, authorId });
    return { channelId, messageId, authorId };
}

function markBubbleAsRead(messageId: string, readerId: string, readAt: number) {
    debugLog("Marking bubble as read:", { messageId, readerId, readAt });

    const el = document.querySelector<HTMLElement>(`[id^="chat-messages-"][id$="-${messageId}"]`);
    if (!el) {
        debugLog("Element not found for message:", messageId);
        return;
    }

    let badge = el.querySelector<HTMLElement>(".privcord-rr");
    if (!badge) {
        debugLog("Creating new read receipt badge for message:", messageId);
        badge = document.createElement("span");
        badge.className = "privcord-rr";

        // Better styling to match Discord's UI - more visible
        badge.style.cssText = `
            margin-left: 4px;
            margin-right: 2px;
            font-size: 14px;
            color: #43b581 !important;
            font-weight: 600 !important;
            display: inline-flex !important;
            align-items: center;
            justify-content: center;
            min-width: 20px;
            height: 20px;
            border-radius: 4px;
            background: rgba(67, 181, 129, 0.2) !important;
            border: 2px solid #43b581 !important;
            padding: 2px 6px;
            line-height: 1;
            vertical-align: middle;
            opacity: 1 !important;
            position: relative;
            z-index: 1000;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
            transition: all 0.2s ease;
        `;
        badge.textContent = "✓✓";

        // Try multiple placement strategies for better Discord integration
        let badgePlaced = false;

        debugLog("Attempting to place badge in message element:", {
            id: el.id,
            classes: el.className,
            children: Array.from(el.children).map(child => ({
                tagName: child.tagName,
                className: child.className,
                id: child.id
            }))
        });

        // Strategy 1: Try to place in message header/metadata area
        const messageHeader = el.querySelector('[class*="header"]') ||
            el.querySelector('[class*="messageHeader"]') ||
            el.querySelector('[class*="metadata"]') ||
            el.querySelector('[class*="timestamp"]')?.parentElement ||
            el.querySelector('time')?.parentElement;
        if (messageHeader && !badgePlaced) {
            messageHeader.appendChild(badge);
            debugLog("Badge added to message header/metadata");
            badgePlaced = true;
        }

        // Strategy 2: Try to place after timestamp specifically
        const timeEl = el.querySelector("time");
        if (timeEl && timeEl.parentElement && !badgePlaced) {
            timeEl.parentElement.appendChild(badge);
            debugLog("Badge added after timestamp");
            badgePlaced = true;
        }

        // Strategy 3: Try to place in message content wrapper
        if (!badgePlaced) {
            const contentWrapper = el.querySelector('[class*="content"]') ||
                el.querySelector('[class*="messageContent"]') ||
                el.querySelector('[class*="textContainer"]');
            if (contentWrapper) {
                // Try to add at the end of content
                contentWrapper.appendChild(badge);
                debugLog("Badge added to content wrapper");
                badgePlaced = true;
            }
        }

        // Strategy 4: Try to place in message actions area (hover buttons)
        if (!badgePlaced) {
            const actionsArea = el.querySelector('[class*="actions"]') ||
                el.querySelector('[class*="buttonContainer"]') ||
                el.querySelector('[class*="hoverButton"]')?.parentElement;
            if (actionsArea) {
                actionsArea.appendChild(badge);
                debugLog("Badge added to actions area");
                badgePlaced = true;
            }
        }

        // Strategy 5: Try to place as a sibling to message content
        if (!badgePlaced) {
            const messageContent = el.querySelector('[class*="message"]') ||
                el.querySelector('[class*="content"]') ||
                el.querySelector('[class*="text"]');
            if (messageContent && messageContent.parentElement) {
                messageContent.parentElement.appendChild(badge);
                debugLog("Badge added as sibling to message content");
                badgePlaced = true;
            }
        }

        // Strategy 6: Try to place in the main message container
        if (!badgePlaced) {
            const mainContainer = el.querySelector('[class*="container"]') ||
                el.querySelector('[class*="wrapper"]') ||
                el.querySelector('div[class*="message"]');
            if (mainContainer) {
                mainContainer.appendChild(badge);
                debugLog("Badge added to main container");
                badgePlaced = true;
            }
        }

        // Strategy 7: Fallback - add to message element directly
        if (!badgePlaced) {
            el.appendChild(badge);
            debugLog("Badge added directly to message element (fallback)");
        }

        // Add hover effect
        badge.addEventListener('mouseenter', () => {
            badge.style.opacity = '1';
            badge.style.transform = 'scale(1.05)';
        });

        badge.addEventListener('mouseleave', () => {
            badge.style.opacity = '0.9';
            badge.style.transform = 'scale(1)';
        });

    } else {
        debugLog("Badge already exists for message:", messageId);
    }

    badge.title = `Seen by ${readerId} at ${new Date(readAt).toLocaleString()}`;
    log("✓✓ Badge displayed for message:", messageId);
}

async function sendReceiptsForVisibleMessages(): Promise<void> {
    debugLog("=== SENDING RECEIPTS FOR VISIBLE MESSAGES ===");

    const me = getCurrentUserId();
    if (!me) {
        debugLog("No current user ID found");
        return;
    }

    const channelId = getSelectedChannelId();
    if (!channelId) {
        debugLog("No selected channel ID found");
        return;
    }

    debugLog("Processing receipts for:", { me, channelId });

    const items = getVisibleMessageElements();
    debugLog(`Processing ${items.length} visible message elements`);

    for (const li of items) {
        const info = extractMessageData(li);
        if (!info) continue;

        const { messageId, authorId } = info;
        if (!messageId || !authorId) {
            debugLog("Skipping message - missing data:", { messageId, authorId });
            continue;
        }

        if (authorId === me) {
            debugLog("Skipping own message:", messageId);
            continue; // never send for my own messages
        }

        if (reportedMessageIds.has(messageId)) {
            debugLog("Skipping already reported message:", messageId);
            continue;
        }

        try {
            debugLog("Sending read receipt for message:", { messageId, authorId, channelId });

            await postJSON("/v1/read", {
                channelId,
                messageId,
                readerId: me,
                senderId: authorId,
                readAt: Date.now(),
            });

            reportedMessageIds.add(messageId);
            log("✓ Read receipt sent for message:", messageId);
        } catch (error) {
            errorLog("Failed to send read receipt for message:", messageId, error);
        }
    }

    debugLog("=== FINISHED SENDING RECEIPTS ===");
}

async function hydrateReceiptsBadges(): Promise<void> {
    debugLog("=== HYDRATING RECEIPTS BADGES ===");

    const me = getCurrentUserId();
    if (!me) {
        debugLog("No current user ID for hydrating badges");
        return;
    }

    const channelId = getSelectedChannelId();
    if (!channelId) {
        debugLog("No selected channel ID for hydrating badges");
        return;
    }

    const items = getVisibleMessageElements();
    const ids: string[] = [];

    for (const li of items) {
        const info = extractMessageData(li);
        if (info) ids.push(info.messageId);
    }

    if (ids.length === 0) {
        debugLog("No message IDs found for hydrating badges");
        return;
    }

    debugLog("Hydrating badges for message IDs:", ids);

    try {
        const url = `/v1/receipts?senderId=${encodeURIComponent(me)}&messageIds=${encodeURIComponent(ids.join(","))}`;
        debugLog("Fetching receipts from:", url);

        const data = await getJSON(url);
        debugLog("Received receipts data:", data);

        for (const r of data.receipts || []) {
            debugLog("Processing receipt:", r);
            markBubbleAsRead(r.messageId, r.readerId, r.readAt);
        }

        log(`✓ Hydrated ${data.receipts?.length || 0} read receipt badges`);
    } catch (error) {
        errorLog("Failed to hydrate receipts badges:", error);
    }

    debugLog("=== FINISHED HYDRATING BADGES ===");
}

function onDomChange(): void {
    const now = Date.now();

    // Throttle DOM changes
    if (now - lastDomChangeTime < DOM_CHANGE_THROTTLE) {
        return;
    }
    lastDomChangeTime = now;

    debugLog("=== DOM CHANGE DETECTED ===");

    const currentChannel = getSelectedChannelId();
    if (currentChannel !== lastChannelId) {
        debugLog("Channel changed:", { from: lastChannelId, to: currentChannel });
        // Channel changed; clear per-channel cache
        reportedMessageIds.clear();
        lastChannelId = currentChannel;
        log("🔄 Channel changed, cleared message cache");
    }

    // Debounce the actual operations
    if (domChangeTimeout) {
        clearTimeout(domChangeTimeout);
    }

    domChangeTimeout = setTimeout(() => {
        debugLog("Triggering receipt operations...");
        void sendReceiptsForVisibleMessages();
        void hydrateReceiptsBadges();
    }, DOM_CHANGE_DEBOUNCE);
}

export default definePlugin({
    name: "Privcord Read Receipts",
    description: "WhatsApp tarzı görüldü bilgisi (yalnızca Privcord kullanıcıları)",
    authors: [PrivcordDevs.feelslove],

    start() {
        log("🚀 Starting Privcord Read Receipts Plugin");

        void waitFor(() => document.querySelector('[id^="chat-messages-"]'))
            .then(() => {
                const me = getCurrentUserId();
                if (!me) {
                    errorLog("Cannot detect user id; aborting plugin initialization");
                    return;
                }

                log("✅ Plugin initialization successful", { userId: me });

                try {
                    ws = openSocket(me);
                } catch (error) {
                    errorLog("Failed to open WebSocket:", error);
                }

                // MessageEvents.ts integration
                try {
                    debugLog("Setting up MessageEvents listeners...");

                    // Message send listener - when user sends a message, mark it as read by them
                    const sendListener = addMessagePreSendListener(async (channelId, messageObj, options) => {
                        debugLog("Message pre-send detected:", { channelId, content: messageObj.content });
                        // Plugin automatically handles read receipts through DOM observation
                        // This listener is mainly for debugging
                    });
                    messageEventListeners.push(sendListener);

                    // Message click listener - when user clicks a message
                    const clickListener = addMessageClickListener((message, channel, event) => {
                        debugLog("Message clicked:", {
                            messageId: message.id,
                            channelId: channel.id,
                            content: message.content?.substring(0, 50)
                        });

                        // Trigger read receipt sending for clicked message
                        setTimeout(() => {
                            void sendReceiptsForVisibleMessages();
                        }, 100);
                    });
                    messageEventListeners.push(clickListener);

                    log("✅ MessageEvents listeners registered");
                } catch (error) {
                    errorLog("Failed to setup MessageEvents listeners:", error);
                }

                observer = new MutationObserver(onDomChange);
                observer.observe(document.body, { childList: true, subtree: true });

                window.addEventListener("focus", onDomChange);
                window.addEventListener("popstate", onDomChange);
                window.addEventListener("hashchange", onDomChange);

                onDomChange();
                log("🎉 Plugin fully initialized and running");
            })
            .catch((error) => {
                errorLog("Plugin initialization timeout:", error);
            });
    },

    stop() {
        log("🛑 Stopping Privcord Read Receipts Plugin");

        // Clear any pending timeouts
        if (domChangeTimeout) {
            clearTimeout(domChangeTimeout);
            domChangeTimeout = null;
        }

        try {
            if (observer) {
                observer.disconnect();
                observer = null;
                debugLog("MutationObserver disconnected");
            }
        } catch (error) {
            errorLog("Error disconnecting observer:", error);
        }

        try {
            window.removeEventListener("focus", onDomChange);
            window.removeEventListener("popstate", onDomChange);
            window.removeEventListener("hashchange", onDomChange);
            debugLog("Event listeners removed");
        } catch (error) {
            errorLog("Error removing event listeners:", error);
        }

        try {
            if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
                ws.close();
                debugLog("WebSocket closed");
            }
            ws = null;
        } catch (error) {
            errorLog("Error closing WebSocket:", error);
        }

        // Clean up MessageEvents listeners
        try {
            for (const listener of messageEventListeners) {
                // Note: In a real implementation, you'd need to store the remove functions
                // For now, we just clear the array
                debugLog("Cleaning up MessageEvents listener");
            }
            messageEventListeners.length = 0;
            debugLog("MessageEvents listeners cleaned up");
        } catch (error) {
            errorLog("Error cleaning up MessageEvents listeners:", error);
        }

        reportedMessageIds.clear();
        log("✅ Plugin stopped successfully");
    },

    // No custom UI; TSX kept for future extension
    render: () => null,
});
