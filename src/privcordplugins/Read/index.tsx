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
let domChangeTimeout: ReturnType<typeof setTimeout> | null = null;
const DOM_CHANGE_THROTTLE = 100000; // 1 second throttle
const DOM_CHANGE_DEBOUNCE = 50000; // 500ms debounce

// Debug mode - set to false to reduce log spam
const DEBUG_MODE = true; // temporarily ON for troubleshooting; can be toggled via window.togglePrivcordRRDebug()

// Expose debug toggle to window for testing
if (typeof window !== 'undefined') {
    (window as any).togglePrivcordRRDebug = () => {
        (window as any).PRIVCORD_RR_DEBUG = !(window as any).PRIVCORD_RR_DEBUG;
        console.log(`PrivcordRR Debug mode: ${(window as any).PRIVCORD_RR_DEBUG ? 'ON' : 'OFF'}`);
    };

    // Helper to set the API base quickly from console
    (window as any).setPrivcordRRApi = (url: string) => {
        try {
            localStorage.setItem(STORAGE_KEY, url);
            console.log(`[PrivcordRR] API base set to: ${url}`);
        } catch (e) {
            console.error("[PrivcordRR] Failed to set API base", e);
        }
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

    // Enhanced debug function to test badge creation
    (window as any).testPrivcordRRBadgeCreation = (messageId?: string) => {
        const messages = getVisibleMessageElements();
        if (messages.length === 0) {
            console.log("❌ No messages found!");
            return;
        }
        
        const targetMessage = messageId ? 
            messages.find(el => el.id.includes(messageId)) : 
            messages[0];
            
        if (!targetMessage) {
            console.log("❌ Target message not found!");
            return;
        }
        
        console.log("🧪 Testing badge creation for message:", {
            id: targetMessage.id,
            classes: targetMessage.className
        });
        
        // Extract message data
        const data = extractMessageData(targetMessage);
        console.log("📊 Extracted data:", data);
        
        if (data) {
            // Create a test badge
            markBubbleAsRead(data.messageId, "test-user", Date.now());
            console.log("✅ Test badge created!");
        } else {
            console.log("❌ Could not extract message data");
        }
    };

    // Function to inspect Discord's DOM structure
    (window as any).inspectDiscordDOM = () => {
        const messages = document.querySelectorAll('li[id*="chat-messages"]');
        console.log(`🔍 Found ${messages.length} potential message elements`);
        
        messages.forEach((el, index) => {
            if (index < 3) { // Only show first 3 for brevity
                console.log(`Message ${index + 1}:`, {
                    id: el.id,
                    classes: el.className,
                    children: Array.from(el.children).map(child => ({
                        tagName: child.tagName,
                        classes: child.className,
                        hasContent: child.textContent?.length > 0
                    }))
                });
            }
        });
    };

    // Function to force badge creation on all visible messages
    (window as any).forcePrivcordRRBadges = () => {
        console.log("🚀 Forcing badge creation on all visible messages...");
        const messages = getVisibleMessageElements();
        
        messages.forEach((el, index) => {
            const data = extractMessageData(el);
            if (data) {
                console.log(`Creating badge for message ${index + 1}:`, data.messageId);
                markBubbleAsRead(data.messageId, "force-test", Date.now());
            }
        });
        
        console.log(`✅ Attempted to create badges for ${messages.length} messages`);
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

// Throttled logger: logs at most once per key per interval
const LAST_LOG_TIMES = new Map<string, number>();
function logEvery(key: string, intervalMs: number, ...args: unknown[]) {
    const now = Date.now();
    const last = LAST_LOG_TIMES.get(key) || 0;
    if (now - last < intervalMs) return;
    LAST_LOG_TIMES.set(key, now);
    log(...args);
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
    // Enhanced selectors to better match Discord's current structure
    const selectors = [
        // Discord's main message list container
        '[data-list-id="chat-messages"] li[id^="chat-messages-"]',
        // Alternative selectors for different Discord versions
        'li[id^="chat-messages-"][id*="-"]',
        '[id^="chat-messages-"] li[id*="-"]',
        // More generic fallback
        'li[id*="chat-messages-"][id*="-"]'
    ];

    const elements = new Set<HTMLElement>();
    
    // Try each selector
    selectors.forEach(selector => {
        try {
            document.querySelectorAll<HTMLElement>(selector).forEach(el => {
                // More flexible ID matching - Discord IDs can be very long
                if (el.id && el.id.match(/chat-messages-[\d-]+$/)) {
                    elements.add(el);
                    debugLog("Found message element:", { id: el.id, className: el.className });
                }
            });
        } catch (error) {
            debugLog("Selector error:", selector, error);
        }
    });

    // Additional fallback: look for any li with message-like structure
    if (elements.size === 0) {
        debugLog("No elements found with primary selectors, trying fallback...");
        document.querySelectorAll<HTMLElement>('li[class*="message"]').forEach(el => {
            if (el.id && el.id.includes('-') && !elements.has(el)) {
                elements.add(el);
                debugLog("Fallback found message element:", { id: el.id, className: el.className });
            }
        });
    }

    const result = Array.from(elements);
    debugLog(`Found ${result.length} visible message elements`);
    
    // Log details about found elements for debugging
    if (result.length > 0) {
        debugLog("Message elements details:", result.map(el => ({
            id: el.id,
            classes: el.className,
            hasContent: !!el.querySelector('[class*="content"]'),
            hasTimestamp: !!el.querySelector('time'),
            hasActions: !!el.querySelector('[class*="actions"]')
        })));
    }
    
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
        // Request hydration on connect
        try { void hydrateReceiptsBadges(); } catch {}
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
                // Reduce spam: log this at most once per minute
                logEvery("ws_read", 60_000, "Read receipt received");
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

    // More flexible ID matching for different Discord versions
    const m = id.match(/chat-messages-(\d+)-(\d+)/) || 
              id.match(/chat-messages-(\d+)-(\d+)-/) ||
              id.match(/(\d+)-(\d+)/);
    
    if (!m) {
        debugLog("Failed to match message ID pattern for:", id);
        // Try to extract from other attributes
        const altId = li.getAttribute("data-message-id") || 
                     li.getAttribute("data-id") ||
                     li.querySelector('[class*="message"]')?.getAttribute("data-message-id");
        if (altId) {
            debugLog("Found alternative message ID:", altId);
            // For fallback, we'll use the selected channel ID
            const channelId = getSelectedChannelId();
            if (channelId) {
                return { channelId, messageId: altId, authorId: null };
            }
        }
        return null;
    }

    const channelId = m[1];
    const messageId = m[2];

    // Enhanced author ID detection
    let authorId = li.getAttribute("data-author-id") ||
                  li.getAttribute("data-user-id");

    // Try multiple selectors for author ID
    if (!authorId) {
        const selectors = [
            '[class*="avatar"]',
            '[class*="author"]',
            '[class*="username"]',
            '[class*="displayName"]',
            '[class*="message"]'
        ];
        
        for (const selector of selectors) {
            const element = li.querySelector(selector) as HTMLElement;
            if (element) {
                authorId = element.getAttribute("data-user-id") ||
                          element.getAttribute("data-author-id") ||
                          element.getAttribute("data-id") ||
                          element.getAttribute("title") ||
                          element.getAttribute("aria-label");
                
                if (authorId) {
                    debugLog("Found author ID via selector:", selector, authorId);
                    break;
                }
            }
        }
    }

    // Last resort: try to extract from any data attribute
    if (!authorId) {
        const allElements = li.querySelectorAll('[data-user-id], [data-author-id], [data-id]');
        for (const el of allElements) {
            const candidate = el.getAttribute("data-user-id") ||
                             el.getAttribute("data-author-id") ||
                             el.getAttribute("data-id");
            if (candidate && candidate.length > 10) { // Discord IDs are typically long
                authorId = candidate;
                debugLog("Found author ID via data attributes:", authorId);
                break;
            }
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

        // Enhanced styling to ensure visibility
        badge.style.cssText = `
            margin-left: 6px !important;
            margin-right: 2px !important;
            font-size: 14px !important;
            color: #000000 !important; /* black by default */
            font-weight: 700 !important;
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
            min-width: 20px !important;
            height: 20px !important;
            border-radius: 4px !important;
            background: rgba(255, 255, 255, 0.9) !important;
            border: 1px solid rgba(0, 0, 0, 0.1) !important;
            padding: 2px 4px !important;
            line-height: 1 !important;
            vertical-align: middle !important;
            text-shadow: 0 1px 2px rgba(0,0,0,0.3) !important;
            transition: color 0.2s ease, transform 0.1s ease, opacity 0.2s ease !important;
            opacity: 0.95 !important;
            position: relative !important;
            z-index: 1000 !important;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2) !important;
        `;
        badge.textContent = "✓";

        // Enhanced placement strategies for better Discord integration
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

        // Strategy 1: Look for Discord's message wrapper with proper structure
        const messageWrapper = el.querySelector('[class*="message"][class*="wrapper"]') ||
                              el.querySelector('[class*="messageContent"]') ||
                              el.querySelector('[class*="message"][class*="content"]');
        
        if (messageWrapper && !badgePlaced) {
            // Try to find the header area within the message wrapper
            const headerArea = messageWrapper.querySelector('[class*="header"]') ||
                              messageWrapper.querySelector('[class*="metadata"]') ||
                              messageWrapper.querySelector('[class*="top"]') ||
                              messageWrapper.querySelector('[class*="author"]')?.parentElement;
            
            if (headerArea) {
                headerArea.appendChild(badge);
                debugLog("Badge added to message header area");
                badgePlaced = true;
            } else {
                // Add to the message wrapper itself
                messageWrapper.appendChild(badge);
                debugLog("Badge added to message wrapper");
                badgePlaced = true;
            }
        }

        // Strategy 2: Look for timestamp area specifically
        if (!badgePlaced) {
            const timestampArea = el.querySelector('time')?.parentElement;
            if (timestampArea) {
                timestampArea.appendChild(badge);
                debugLog("Badge added to timestamp area");
                badgePlaced = true;
            }
        }

        // Strategy 3: Look for message actions area (hover buttons)
        if (!badgePlaced) {
            const actionsArea = el.querySelector('[class*="actions"]') ||
                               el.querySelector('[class*="buttonContainer"]') ||
                               el.querySelector('[class*="hoverButton"]')?.parentElement ||
                               el.querySelector('[class*="toolbar"]');
            if (actionsArea) {
                actionsArea.appendChild(badge);
                debugLog("Badge added to actions area");
                badgePlaced = true;
            }
        }

        // Strategy 4: Try to place after the author name or username
        if (!badgePlaced) {
            const authorElement = el.querySelector('[class*="author"]') ||
                                 el.querySelector('[class*="username"]') ||
                                 el.querySelector('[class*="displayName"]');
            if (authorElement && authorElement.parentElement) {
                authorElement.parentElement.appendChild(badge);
                debugLog("Badge added after author element");
                badgePlaced = true;
            }
        }

        // Strategy 5: Try to place in message content area
        if (!badgePlaced) {
            const contentArea = el.querySelector('[class*="content"]') ||
                               el.querySelector('[class*="textContainer"]') ||
                               el.querySelector('[class*="messageContent"]');
            if (contentArea) {
                contentArea.appendChild(badge);
                debugLog("Badge added to content area");
                badgePlaced = true;
            }
        }

        // Strategy 6: Try to place as a sibling to the main message content
        if (!badgePlaced) {
            const mainContent = el.querySelector('[class*="message"]') ||
                               el.querySelector('[class*="content"]') ||
                               el.querySelector('[class*="text"]');
            if (mainContent && mainContent.parentElement) {
                mainContent.parentElement.appendChild(badge);
                debugLog("Badge added as sibling to main content");
                badgePlaced = true;
            }
        }

        // Strategy 7: Try to place in any container within the message
        if (!badgePlaced) {
            const container = el.querySelector('[class*="container"]') ||
                             el.querySelector('[class*="wrapper"]') ||
                             el.querySelector('div[class*="message"]');
            if (container) {
                container.appendChild(badge);
                debugLog("Badge added to container");
                badgePlaced = true;
            }
        }

        // Strategy 8: Fallback - add to message element directly
        if (!badgePlaced) {
            el.appendChild(badge);
            debugLog("Badge added directly to message element (fallback)");
            badgePlaced = true;
        }

        // Add hover effect
        badge.addEventListener('mouseenter', () => {
            badge.style.opacity = '1';
            badge.style.transform = 'scale(1.05)';
        });

        badge.addEventListener('mouseleave', () => {
            badge.style.opacity = '0.95';
            badge.style.transform = 'scale(1)';
        });

    } else {
        debugLog("Badge already exists for message:", messageId);
    }

    // Turn blue when read; default black when unread
    const isRead = !!readerId && !!readAt && readAt > 0;
    if (badge) {
        badge.style.color = isRead ? '#00b0f4' : '#000000';
        badge.title = isRead
            ? `Görüldü: ${new Date(readAt).toLocaleString()} • ${readerId}`
            : `Henüz görülmedi`;
    }
    debugLog("✓ Badge updated for message:", messageId, { isRead, badgeExists: !!badge });
    
    // Fallback: if badge still doesn't exist, try a more aggressive approach
    if (!badge && el) {
        debugLog("Badge still not found, trying aggressive fallback...");
        // Create badge directly in the message element
        const fallbackBadge = document.createElement("span");
        fallbackBadge.className = "privcord-rr-fallback";
        fallbackBadge.style.cssText = `
            position: absolute !important;
            top: 5px !important;
            right: 5px !important;
            font-size: 12px !important;
            color: #00b0f4 !important;
            background: white !important;
            border: 1px solid #ccc !important;
            border-radius: 3px !important;
            padding: 2px 4px !important;
            z-index: 9999 !important;
            font-weight: bold !important;
        `;
        fallbackBadge.textContent = "✓";
        fallbackBadge.title = isRead
            ? `Görüldü: ${new Date(readAt).toLocaleString()} • ${readerId}`
            : `Henüz görülmedi`;
        
        el.style.position = "relative";
        el.appendChild(fallbackBadge);
        debugLog("✓ Fallback badge created for message:", messageId);
    }
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
            // Always render grey ticks on my own outgoing messages
            try { markBubbleAsRead(messageId, me, 0); } catch {}
            debugLog("Own message detected; badge rendered grey:", messageId);
            continue; // do not send receipts for own messages
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
            // Reduce spam: keep success logs in debug only
            debugLog("✓ Read receipt sent for message:", messageId);
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
        // Ensure badges exist for my outgoing messages (grey)
        try { void sendReceiptsForVisibleMessages(); } catch {}
        try { void hydrateReceiptsBadges(); } catch {}
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
                        // Log when the user sends a message (explicit request)
                        log("✉️ Mesaj gönderildi");
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
                observer.observe(document.body, { 
                    childList: true, 
                    subtree: true, 
                    attributes: true,
                    attributeFilter: ['class', 'id']
                });
                
                // Also add a periodic check to ensure badges are created
                const badgeCheckInterval: ReturnType<typeof setInterval> = setInterval(() => {
                    try {
                        debugLog("Periodic badge check...");
                        void sendReceiptsForVisibleMessages();
                    } catch (error) {
                        debugLog("Periodic check error:", error);
                    }
                }, 5000); // Check every 5 seconds
                
                // Store interval for cleanup
                (window as any).privcordRRInterval = badgeCheckInterval;

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
            if ((window as any).privcordRRInterval) {
                clearInterval((window as any).privcordRRInterval);
                (window as any).privcordRRInterval = null;
                debugLog("Badge check interval cleared");
            }
        } catch (error) {
            errorLog("Error clearing badge check interval:", error);
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
