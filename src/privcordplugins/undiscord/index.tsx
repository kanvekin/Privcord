/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { Button, React, Toasts } from "@webpack/common";

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
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const code = await res.text();
        // Execute in page context
        // eslint-disable-next-line no-new-func
        const runner = new Function(code);
        runner();
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
