/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { Button, React, Toasts, UserStore, GuildStore, ChannelStore } from "@webpack/common";
import { findByPropsLazy } from "@webpack";

const settings = definePluginSettings({
    sourceUrl: {
        type: OptionType.STRING,
        description: "Undiscord userscript URL",
        default:
            "https://raw.githubusercontent.com/victornpb/undiscord/master/deleteDiscordMessages.user.js",
    },
    autoLaunchOnStartup: {
        type: OptionType.BOOLEAN,
        description: "Launch Undiscord automatically once on startup",
        default: true,
    },
    globalIncludeDMs: {
        type: OptionType.BOOLEAN,
        description: "Include DMs in global delete",
        default: false,
    },
    globalThrottleMs: {
        type: OptionType.NUMBER,
        description: "Delay between guild/channel runs (ms)",
        default: 1500,
        min: 0,
        max: 10000,
    },
});

async function loadUndiscordFrom(url: string) {
    try {
        // Ensure token is available and auth headers will be injected
        await injectToken();
        patchNetworkAuth();

        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const code = await res.text();
        // Execute in page context, but if the script prompts for token, auto-supply it
        // eslint-disable-next-line no-new-func
        const runner = new Function(code);
        const Auth: { getToken?: () => string } = findByPropsLazy("getToken");
        const token = Auth?.getToken?.();
        const originalPrompt = window.prompt?.bind(window) ?? null;
        if (token && originalPrompt) {
            window.prompt = ((message?: string, _default?: string) => {
                const msg = (message || "").toLowerCase();
                if (msg.includes("token") || msg.includes("authorization")) return token;
                return originalPrompt(message, _default);
            }) as typeof window.prompt;
        }
        try {
            runner();
        } finally {
            if (originalPrompt) window.prompt = originalPrompt;
        }
        Toasts.show({
            message: "Undiscord launched",
            id: Toasts.genId(),
            type: Toasts.Type.SUCCESS,
        });
    } catch (e: any) {
        Toasts.show({
            message: `Failed to load Undiscord: ${e?.message ?? e}`,
            id: Toasts.genId(),
            type: Toasts.Type.FAILURE,
        });
        throw e;
    }
}

// ---------------- Global Delete Runner ----------------
let __globalRunnerActive = false;
let __globalRunnerStopping = false;

function getAllGuildIds(): string[] {
    try {
        const g = (GuildStore as any);
        const store = g?.getGuilds?.();
        if (store) {
            if (store instanceof Map) return Array.from(store.keys());
            const keys = Object.keys(store);
            return keys.length ? keys : Object.values(store)?.map((x: any) => x.id).filter(Boolean) ?? [];
        }
    } catch {}
    return [];
}

function getAllDmChannelIds(): string[] {
    try {
        const cs = (ChannelStore as any);
        const priv = cs?.getPrivateChannels?.() ?? cs?.getPrivateChannelIds?.();
        if (Array.isArray(priv)) return priv.map((c: any) => (typeof c === "string" ? c : c?.channel?.id || c?.id)).filter(Boolean);
        if (priv && typeof priv === "object") return Object.keys(priv);
    } catch {}
    return [];
}

function setInput(selector: string, value: string) {
    const el = document.querySelector<HTMLInputElement>(selector);
    if (!el) return false;
    el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
}

function clickButtonByText(label: string): boolean {
    const btns = Array.from(document.querySelectorAll<HTMLButtonElement>("button"));
    const btn = btns.find(b => (b.textContent || "").trim().toLowerCase() === label.toLowerCase());
    if (btn) {
        btn.click();
        return true;
    }
    return false;
}

function isUndiscordRunning(): boolean {
    // Heuristic: look for a running button or progress element
    const runningBtn = document.querySelector('[class*="undisc"][class*="running"], .undicord-btn.running, .undiscord .footer progress');
    return !!runningBtn;
}

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function runUndiscordFor(authorId: string, guildId?: string, channelId?: string) {
    // Fill form
    setInput('#authorId, input[name="authorId"]', authorId);
    setInput('#guildId, input[name="guildId"]', guildId ?? "");
    setInput('#channelId, input[name="channelId"]', channelId ?? "");

    // Start
    if (!clickButtonByText("Start")) clickButtonByText("RUN");

    // Wait while running, allow stop
    for (;;) {
        if (__globalRunnerStopping) {
            clickButtonByText("Stop");
            break;
        }
        if (!isUndiscordRunning()) break;
        await sleep(500);
    }
}

async function startGlobalDelete() {
    if (__globalRunnerActive) return;
    __globalRunnerActive = true;
    __globalRunnerStopping = false;

    try {
        await loadUndiscordFrom(settings.store.sourceUrl);
        await sleep(400);

        const me = UserStore.getCurrentUser();
        const authorId = me?.id;
        if (!authorId) throw new Error("Could not resolve current user");

        const guildIds = getAllGuildIds();
        const dmIds = settings.store.globalIncludeDMs ? getAllDmChannelIds() : [];

        const total = guildIds.length + dmIds.length;
        Toasts.show({ message: `Global delete started (${total} targets)`, id: Toasts.genId(), type: Toasts.Type.MESSAGE });

        for (const gid of guildIds) {
            if (!__globalRunnerActive) break;
            await runUndiscordFor(authorId, gid, "");
            await sleep(settings.store.globalThrottleMs);
        }

        for (const chid of dmIds) {
            if (!__globalRunnerActive) break;
            await runUndiscordFor(authorId, "", chid);
            await sleep(settings.store.globalThrottleMs);
        }

        Toasts.show({ message: "Global delete finished", id: Toasts.genId(), type: Toasts.Type.SUCCESS });
    } catch (e: any) {
        Toasts.show({ message: `Global delete error: ${e?.message ?? e}`, id: Toasts.genId(), type: Toasts.Type.FAILURE });
    } finally {
        __globalRunnerActive = false;
        __globalRunnerStopping = false;
    }
}

function stopGlobalDelete() {
    if (!__globalRunnerActive) return;
    __globalRunnerStopping = true;
    Toasts.show({ message: "Stopping global delete...", id: Toasts.genId(), type: Toasts.Type.MESSAGE });
}

// Try to inject the current auth token so Undiscord can authenticate API requests
async function injectToken() {
    try {
        const Auth: { getToken?: () => string } = findByPropsLazy("getToken");
        const token = Auth?.getToken?.();
        if (!token) return;

        // Discord stores the token as a JSON string in localStorage
        try {
            localStorage.setItem("token", JSON.stringify(token));
        } catch {}

        // Provide a global escape hatch some scripts may read
        try {
            (window as any).UNDDISCORD_TOKEN = token;
        } catch {}
    } catch {
        // ignore, fallback to userscript's own token discovery
    }
}

// Force auth onto Discord API requests even if the userscript cannot obtain the token itself
function patchNetworkAuth() {
    try {
        const Auth: { getToken?: () => string } = findByPropsLazy("getToken");
        const token = Auth?.getToken?.();
        if (!token) return;

        const isDiscordApi = (input: RequestInfo | URL): boolean => {
            try {
                const u = typeof input === "string" ? new URL(input, location.origin) : new URL((input as Request).url ?? String(input), location.origin);
                if (u.origin === location.origin && u.pathname.startsWith("/api")) return true;
                const host = u.hostname;
                return (
                    /(^|\.)discord\.com$/.test(host) ||
                    /(^|\.)discordapp\.com$/.test(host)
                ) && u.pathname.startsWith("/api");
            } catch {
                return false;
            }
        };

        // Patch fetch
        const origFetch = window.fetch;
        if (!(origFetch as any).__undiscord_patched) {
            const patchedFetch: typeof fetch = async (input, init = {}) => {
                if (isDiscordApi(input)) {
                    const existingHeaders = (init as any)?.headers || (input instanceof Request ? input.headers : undefined);
                    const headers = new Headers(existingHeaders);

                    // Determine full URL to decide if we must force auth
                    let urlStr = "";
                    let methodStr = (init as RequestInit)?.method || (input instanceof Request ? input.method : "GET");
                    try {
                        const u = typeof input === "string" ? new URL(input, location.origin) : new URL((input as Request).url ?? String(input), location.origin);
                        urlStr = u.pathname;
                    } catch {}

                    const hasAuth = headers.has("Authorization");
                    const authVal = hasAuth ? String(headers.get("Authorization") || "") : "";
                    const invalidAuth = !authVal || authVal === "undefined" || authVal === "null" || authVal.length < 10;

                    // Force for messages/search and message DELETE endpoints; otherwise set if missing/invalid
                    const isDeleteMessage = methodStr.toUpperCase() === "DELETE" && /\/channels\/.+\/messages\//.test(urlStr);
                    if (urlStr.includes("/messages/search") || isDeleteMessage) {
                        headers.set("Authorization", token);
                    } else if (!hasAuth || invalidAuth) {
                        headers.set("Authorization", token);
                    }

                    if (input instanceof Request) {
                        const req = new Request(input, {
                            method: input.method,
                            headers,
                            body: (input as any)._bodyInit ?? undefined,
                            mode: input.mode,
                            credentials: input.credentials,
                            cache: input.cache,
                            redirect: input.redirect,
                            referrer: input.referrer,
                            referrerPolicy: input.referrerPolicy,
                            integrity: input.integrity,
                            keepalive: (input as any).keepalive,
                            signal: input.signal,
                        });
                        return origFetch(req);
                    }
                    init = { ...(init as RequestInit), headers };
                }
                return origFetch(input as any, init);
            };
            (patchedFetch as any).__undiscord_patched = true;
            window.fetch = patchedFetch;
        }

        // Patch XMLHttpRequest
        const XHR = window.XMLHttpRequest;
        if (XHR && !(XHR as any).__undiscord_patched) {
            const Open = XHR.prototype.open;
            const Send = XHR.prototype.send;
            const SetHeader = XHR.prototype.setRequestHeader;
            XHR.prototype.open = function(this: XMLHttpRequest, method: string, url: string | URL, ...rest: any[]) {
                (this as any).__und_url = url;
                (this as any).__und_is_api = isDiscordApi(url);
                (this as any).__und_method = (method || "GET").toUpperCase();
                (this as any).__und_has_auth = false;
                return Reflect.apply(Open, this, [method, url as any, ...rest]);
            } as typeof XHR.prototype.open;
            XHR.prototype.send = function(this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
                try {
                    if ((this as any).__und_is_api) {
                        const url = String((this as any).__und_url || "");
                        const method = String((this as any).__und_method || "GET");
                        const isDeleteMessage = method === "DELETE" && /\/channels\/.+\/messages\//.test(url);
                        if (isDeleteMessage) {
                            // Force Authorization for delete message endpoint
                            this.setRequestHeader("Authorization", token);
                            (this as any).__und_auth_set = true;
                        } else if (!(this as any).__und_has_auth) {
                            this.setRequestHeader("Authorization", token);
                            (this as any).__und_auth_set = true;
                        }
                    }
                } catch {}
                return Reflect.apply(Send, this, [body as any]);
            } as typeof XHR.prototype.send;
            // Track if Authorization was already set
            XHR.prototype.setRequestHeader = function(this: XMLHttpRequest, name: string, value: string) {
                try {
                    if (name.toLowerCase() === "authorization") (this as any).__und_has_auth = true;
                } catch {}
                return Reflect.apply(SetHeader, this, [name, value]);
            } as typeof XHR.prototype.setRequestHeader;
            (XHR as any).__undiscord_patched = true;
        }
    } catch {
        // ignore, best-effort
    }
}

function LaunchButton() {
    return (
        <Button
            size={Button.Sizes.MEDIUM}
            color={Button.Colors.GREEN}
            onClick={() => loadUndiscordFrom(settings.store.sourceUrl)}
        >
            Launch Undiscord
        </Button>
    );
}

function LaunchGlobalButton() {
    return (
        <Button
            size={Button.Sizes.MEDIUM}
            color={Button.Colors.PRIMARY}
            onClick={async () => {
                await loadUndiscordFrom(settings.store.sourceUrl);
                setTimeout(() => configureGlobalDelete(), 300);
            }}
        >
            Launch (Global: All My Messages)
        </Button>
    );
}

function configureGlobalDelete() {
    try {
        const me = UserStore.getCurrentUser();
        const authorId = me?.id;
        if (!authorId) return;

        const set = (selector: string, value: string) => {
            const el = document.querySelector<HTMLInputElement>(selector);
            if (el) {
                el.value = value;
                el.dispatchEvent(new Event("input", { bubbles: true }));
                el.dispatchEvent(new Event("change", { bubbles: true }));
            }
        };

        // Try common selectors by id or name used by Undiscord
        set('#authorId, input[name="authorId"]', authorId);
        set('#guildId, input[name="guildId"]', "");
        set('#channelId, input[name="channelId"]', "");

        Toasts.show({
            message: "Undiscord configured for global self-delete. Review and press Start.",
            id: Toasts.genId(),
            type: Toasts.Type.MESSAGE,
        });
    } catch {}
}

export default definePlugin({
    name: "undiscord",
    description:
        "Integrates Undiscord (bulk delete) and launches the original userscript UI inside Discord",
    authors: [Devs.feelslove],
    tags: ["messages", "tools", "cleanup"],
    enabledByDefault: false,
    settings,

    start() {
        // Auto-launch once on startup if enabled
        try {
            if (settings.store.autoLaunchOnStartup && !(window as any).__undiscord_autorun_done) {
                (window as any).__undiscord_autorun_done = true;
                setTimeout(() => {
                    void loadUndiscordFrom(settings.store.sourceUrl);
                }, 1000);
            }
        } catch {}
    },
    stop() {},

    settingsAboutComponent: () => (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <LaunchButton />
                <LaunchGlobalButton />
                <Button size={Button.Sizes.MEDIUM} color={Button.Colors.PRIMARY} onClick={() => startGlobalDelete()}>
                    Run Global Delete
                </Button>
                <Button size={Button.Sizes.MEDIUM} color={Button.Colors.RED} onClick={() => stopGlobalDelete()}>
                    Stop Global Run
                </Button>
            </div>
            <span style={{ color: "var(--text-muted)", fontSize: 12 }}>
                Global delete iterates your Guilds {settings.store.globalIncludeDMs ? "+ DMs " : ""}and starts Undiscord per target. You can stop anytime.
            </span>
        </div>
    ),
});
