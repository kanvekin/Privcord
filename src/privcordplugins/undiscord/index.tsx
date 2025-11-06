/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { Button, React, Toasts } from "@webpack/common";
import { findByPropsLazy } from "@webpack";

const settings = definePluginSettings({
    sourceUrl: {
        type: OptionType.STRING,
        description: "Undiscord userscript URL",
        default:
            "https://raw.githubusercontent.com/victornpb/undiscord/master/deleteDiscordMessages.user.js",
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
                    const headers = new Headers((init as any)?.headers || (input instanceof Request ? input.headers : undefined));
                    // Always enforce our Authorization
                    headers.set("Authorization", token);
                    if (input instanceof Request) {
                        const req = new Request(input, { headers });
                        return origFetch(req);
                    }
                    init = { ...init, headers } as RequestInit;
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
                return Reflect.apply(Open, this, [method, url as any, ...rest]);
            } as typeof XHR.prototype.open;
            XHR.prototype.send = function(this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
                try {
                    const url = (this as any).__und_url;
                    if (url && isDiscordApi(url)) {
                        // Enforce after any prior header manipulations
                        this.setRequestHeader("Authorization", token);
                        (this as any).__und_auth_set = true;
                    }
                } catch {}
                return Reflect.apply(Send, this, [body as any]);
            } as typeof XHR.prototype.send;
            // Ensure any attempts to set Authorization use our token
            XHR.prototype.setRequestHeader = function(this: XMLHttpRequest, name: string, value: string) {
                try {
                    if (name.toLowerCase() === "authorization") {
                        return Reflect.apply(SetHeader, this, [name, token]);
                    }
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

export default definePlugin({
    name: "undiscord",
    description:
        "Integrates Undiscord (bulk delete) and launches the original userscript UI inside Discord",
    authors: [Devs.feelslove],
    tags: ["messages", "tools", "cleanup"],
    enabledByDefault: false,
    settings,

    start() {},
    stop() {},

    settingsAboutComponent: () => (
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <LaunchButton />
            <span style={{ color: "var(--text-muted)", fontSize: 12 }}>
                Loads from GitHub and runs the original Undiscord userscript.
            </span>
        </div>
    ),
});
