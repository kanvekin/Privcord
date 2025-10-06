import React from "react";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";

// Minimal, DOM-driven Vencord plugin that:
// - Detects visible messages in the chat list
// - Sends read-receipts to Privcord API for messages authored by others
// - Opens a WebSocket to receive realtime read events
// - Renders a simple ✓✓ badge next to messages that have been read by the recipient

let ws: WebSocket | null = null;
let observer: MutationObserver | null = null;
let lastChannelId: string | null = null;
const reportedMessageIds = new Set<string>();

const STORAGE_KEY = "privcord_rr_api";

function getApiBase(): string {
    return localStorage.getItem(STORAGE_KEY) || "http://localhost:4317";
}

function log(...args: unknown[]) {
    // eslint-disable-next-line no-console
    console.log("[PrivcordRR]", ...args);
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
        return u?.id ?? null;
    } catch {
        return null;
    }
}

function getSelectedChannelId(): string | null {
    try {
        const cid = SelectedChannelStore?.getChannelId?.();
        return cid ?? null;
    } catch {
        return null;
    }
}

function getVisibleMessageElements(): HTMLElement[] {
    return Array.from(
        document.querySelectorAll<HTMLElement>(
            '[id^="chat-messages-"] [data-list-id="chat-messages"] li[id^="chat-messages-"], [aria-label="Messages in"] li[id^="chat-messages-"]'
        )
    );
}

async function postJSON(path: string, body: unknown): Promise<unknown> {
    const base = getApiBase();
    const res = await fetch(`${base}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

async function getJSON(path: string): Promise<any> {
    const base = getApiBase();
    const res = await fetch(`${base}${path}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

function openSocket(userId: string): WebSocket {
    const base = getApiBase();
    const u = new URL(`${base.replace(/^http/, "ws")}/ws`);
    u.searchParams.set("userId", userId);
    const s = new WebSocket(u);
    s.onopen = () => log("ws open");
    s.onclose = () => log("ws close");
    s.onmessage = (ev) => {
        try {
            const msg = JSON.parse(ev.data);
            if (msg?.type === "read") {
                markBubbleAsRead(msg.payload.messageId, msg.payload.readerId, msg.payload.readAt);
            }
        } catch { }
    };
    return s;
}

function extractMessageData(li: HTMLElement): { channelId: string; messageId: string; authorId: string | null; } | null {
    // Expect li id like: chat-messages-<channelId>-<messageId>
    const id = li?.id || "";
    const m = id.match(/chat-messages-(\d+)-(\d+)/);
    if (!m) return null;
    const channelId = m[1];
    const messageId = m[2];

    // Author id heuristic: prefer data-author-id if present; else try to read from avatar anchor/title when present
    const authorId = li.getAttribute("data-author-id") || null;
    return { channelId, messageId, authorId };
}

function markBubbleAsRead(messageId: string, readerId: string, readAt: number) {
    const el = document.querySelector<HTMLElement>(`[id^="chat-messages-"][id$="-${messageId}"]`);
    if (!el) return;
    let badge = el.querySelector<HTMLElement>(".privcord-rr");
    if (!badge) {
        badge = document.createElement("span");
        badge.className = "privcord-rr";
        badge.style.marginLeft = "6px";
        badge.style.fontSize = "11px";
        badge.style.opacity = "0.7";
        badge.textContent = "✓✓";
        const timeEl = el.querySelector("time");
        if (timeEl && timeEl.parentElement) timeEl.parentElement.appendChild(badge);
        else el.appendChild(badge);
    }
    badge.title = `Seen by ${readerId} at ${new Date(readAt).toLocaleString()}`;
}

async function sendReceiptsForVisibleMessages(): Promise<void> {
    const me = getCurrentUserId();
    if (!me) return;
    const channelId = getSelectedChannelId();
    if (!channelId) return;

    const items = getVisibleMessageElements();
    for (const li of items) {
        const info = extractMessageData(li);
        if (!info) continue;
        const { messageId, authorId } = info;
        if (!messageId || !authorId) continue;
        if (authorId === me) continue; // never send for my own messages
        if (reportedMessageIds.has(messageId)) continue;

        try {
            await postJSON("/v1/read", {
                channelId,
                messageId,
                readerId: me,
                senderId: authorId,
                readAt: Date.now(),
            });
            reportedMessageIds.add(messageId);
        } catch {
            // ignore network errors
        }
    }
}

async function hydrateReceiptsBadges(): Promise<void> {
    const me = getCurrentUserId();
    if (!me) return;
    const channelId = getSelectedChannelId();
    if (!channelId) return;

    const items = getVisibleMessageElements();
    const ids: string[] = [];
    for (const li of items) {
        const info = extractMessageData(li);
        if (info) ids.push(info.messageId);
    }
    if (ids.length === 0) return;

    try {
        const data = await getJSON(
            `/v1/receipts?senderId=${encodeURIComponent(me)}&messageIds=${encodeURIComponent(ids.join(","))}`
        );
        for (const r of data.receipts || []) {
            markBubbleAsRead(r.messageId, r.readerId, r.readAt);
        }
    } catch {
        // ignore
    }
}

function onDomChange(): void {
    const currentChannel = getSelectedChannelId();
    if (currentChannel !== lastChannelId) {
        // Channel changed; clear per-channel cache
        reportedMessageIds.clear();
        lastChannelId = currentChannel;
    }
    void sendReceiptsForVisibleMessages();
    void hydrateReceiptsBadges();
}

export default definePlugin({
    name: "Privcord Read Receipts",
    description: "WhatsApp tarzı görüldü bilgisi (yalnızca Privcord kullanıcıları)",
    authors: [Devs.feelslove],

    start() {
        void waitFor(() => document.querySelector('[id^="chat-messages-"]'))
            .then(() => {
                const me = getCurrentUserId();
                if (!me) {
                    log("cannot detect user id; aborting");
                    return;
                }
                try {
                    ws = openSocket(me);
                } catch { }

                observer = new MutationObserver(onDomChange);
                observer.observe(document.body, { childList: true, subtree: true });

                window.addEventListener("focus", onDomChange);
                window.addEventListener("popstate", onDomChange);
                window.addEventListener("hashchange", onDomChange);

                onDomChange();
            })
            .catch(() => {
                log("init timeout");
            });
    },

    stop() {
        try {
            if (observer) {
                observer.disconnect();
                observer = null;
            }
        } catch { }
        try {
            window.removeEventListener("focus", onDomChange);
            window.removeEventListener("popstate", onDomChange);
            window.removeEventListener("hashchange", onDomChange);
        } catch { }
        try {
            if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) ws.close();
            ws = null;
        } catch { }
        reportedMessageIds.clear();
    },

    // No custom UI; TSX kept for future extension
    render: () => null,
});
