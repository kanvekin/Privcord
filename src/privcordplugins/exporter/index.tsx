/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { Message } from "@vencord/discord-types";
import { ChannelStore, Constants, Menu, React,RestAPI, Toasts } from "@webpack/common";

const settings = definePluginSettings({
    includeImages: { type: OptionType.BOOLEAN, default: true, description: "Include image attachments" },
});

async function fetchAllMessages(channelId: string): Promise<Message[]> {
    const result: Message[] = [] as any;
    let before: string | undefined = undefined;

    while (true) {
        const res = await RestAPI.get({
            url: Constants.Endpoints.MESSAGES(channelId),
            query: { limit: 100, ...(before ? { before } : {}) },
            retries: 2
        }).catch(() => null as any);

        const batch = res?.body ?? [];
        if (!batch.length) break;
        result.push(...batch);
        before = batch[batch.length - 1].id;
        if (batch.length < 100) break;
    }

    return result.reverse();
}

function escapeHtml(s: string): string {
    return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function renderHtml(channelId: string, messages: Message[]): string {
    const channel = ChannelStore.getChannel(channelId);
    const title = channel?.name || "DM Export";
    const rows = messages.map((m: any) => {
        const time = new Date(m.timestamp).toLocaleString();
        const author = (m.author?.globalName || m.author?.username || "");
        const content = escapeHtml(m.content || "");
        const attachments = (settings.store.includeImages ? (m.attachments || []) : [])
            .map((a: any) => `<div class="att"><a href="${a.url}" target="_blank">${escapeHtml(a.filename || a.url)}</a>${a.content_type?.startsWith("image/") ? `<br/><img src="${a.url}" style="max-width:480px;max-height:360px"/>` : ""}</div>`)?.join("") || "";
        return `<div class="msg"><div class="meta"><span class="author">${escapeHtml(author)}</span> <span class="time">${escapeHtml(time)}</span></div><div class="body">${content}${attachments}</div></div>`;
    }).join("");

    return `<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<title>${escapeHtml(title)} - Export</title>
<style>
body{font-family:system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:var(--background-primary,#2b2d31);color:var(--text-normal,#dbdee1);} 
.container{max-width:900px;margin:0 auto;padding:16px}
.msg{padding:8px 12px;border-bottom:1px solid rgba(255,255,255,.06)}
.meta{opacity:.7;margin-bottom:4px}
.author{font-weight:600}
.time{margin-left:8px;font-size:.9em}
.body{white-space:pre-wrap;word-wrap:break-word}
.att{margin-top:6px}
img{border-radius:6px}
</style>
</head>
<body>
<div class="container">
<h2>${escapeHtml(title)}</h2>
${rows}
</div>
</body>
</html>`;
}

async function exportChannel(channelId: string) {
    Toasts.show({ id: Toasts.genId(), type: Toasts.Type.MESSAGE, message: "Exporting..." });
    const messages = await fetchAllMessages(channelId);
    const html = renderHtml(channelId, messages as any);

    const filename = `export-${channelId}-${new Date().toISOString().split("T")[0]}.html`;
    if ((window as any).IS_DISCORD_DESKTOP) {
        const data = new TextEncoder().encode(html);
        const saved = await (window as any).DiscordNative.fileManager.saveWithDialog(data, filename, "text/html");
        if (saved) Toasts.show({ id: Toasts.genId(), type: Toasts.Type.SUCCESS, message: "Export saved." });
        else Toasts.show({ id: Toasts.genId(), type: Toasts.Type.FAILURE, message: "Export canceled." });
    } else {
        const blob = new Blob([html], { type: "text/html" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
        Toasts.show({ id: Toasts.genId(), type: Toasts.Type.SUCCESS, message: "Export downloaded." });
    }
}

const contextPatch = (children: Array<React.ReactElement<any> | null>, props: { channel: { id: string } }) => {
    if (!props?.channel?.id) return;
    if (!children.some(c => (c as any)?.props?.id === "pc-export")) {
        children.push(
            <Menu.MenuItem id="pc-export" label="Export" action={() => exportChannel(props.channel.id)} />
        );
    }
};

export default definePlugin({
    name: "Exporter",
    description: "Right-click DM/Group -> Export full chat as HTML with unlimited pagination.",
    authors: [Devs.feelslove],
    settings,
    contextMenus: {
        "channel-context": contextPatch,
        "gdm-context": contextPatch
    }
});
