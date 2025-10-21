/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import { showItemInFolder } from "@utils/native";
import { ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalProps, ModalRoot, openModal } from "@utils/modal";
import definePlugin, { OptionType } from "@utils/types";
import { Message } from "@vencord/discord-types";
import { Button, ChannelStore, Constants, ContextMenuApi, GuildChannelStore, GuildStore, Menu, MessageActions, React, RelationshipStore, RestAPI, Toasts, UserStore } from "@webpack/common";
import { ChatBarButton } from "@api/ChatButtons";

type DeletedLogItem = {
    channelId: string;
    guildId?: string | null;
    dmRecipientId?: string | null;
    isGuild: boolean;
    messageId: string;
    timestamp: string;
    content: string;
    attachments?: Array<{ filename?: string; url: string; content_type?: string; }>
};

const settings = definePluginSettings({
    whitelist: {
        type: OptionType.STRING,
        description: "Comma-separated user IDs to keep (whitelist)",
        default: ""
    },
    includeGuilds: {
        type: OptionType.BOOLEAN,
        description: "Also delete your messages in servers",
        default: true
    },
    includeGroupDMs: {
        type: OptionType.BOOLEAN,
        description: "Also delete messages in Group DMs (non-whitelisted participants)",
        default: false
    },
    lastLogFilePath: {
        type: OptionType.STRING,
        description: "Path of last deletion log (desktop only)",
        default: ""
    },
    logActions: {
        type: OptionType.COMPONENT,
        component: function LogActions() {
            const { lastLogFilePath } = settings.use(["lastLogFilePath"]);
            return (
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <Button
                        disabled={!lastLogFilePath}
                        onClick={() => lastLogFilePath && showItemInFolder(lastLogFilePath)}
                    >Open last log location</Button>
                    {!lastLogFilePath && <span style={{ opacity: .7 }}>No log saved yet</span>}
                </div>
            );
        }
    }
});

function parseCsv(csv: string): string[] {
    return csv
        .split(/[\s,]+/)
        .map(s => s.trim())
        .filter(Boolean);
}

function uniq(arr: string[]): string[] {
    return Array.from(new Set(arr));
}

function getWhitelist(): string[] {
    return uniq(parseCsv(settings.store.whitelist));
}

function setWhitelist(ids: string[]) {
    settings.store.whitelist = ids.join(",");
}

async function wait(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchAllMessages(channelId: string, throttleMs = 250): Promise<Message[]> {
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
        // be gentle to avoid rate limits
        await wait(throttleMs);
    }

    return result.reverse();
}

function FriendTag({ id, onRemove }: { id: string; onRemove: (id: string) => void; }) {
    const user = UserStore.getUser(id);
    if (!user) return null as any;
    return (
        <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 6px", background: "var(--background-secondary)", borderRadius: 6, marginRight: 6, marginBottom: 6 }}>
            <img src={user.getAvatarURL?.(undefined, 16, false)} width={16} height={16} style={{ borderRadius: "50%" }} />
            <span>{(user as any).globalName || user.username}</span>
            <button aria-label="remove" onClick={() => onRemove(id)} style={{ background: "transparent", border: 0, cursor: "pointer", color: "var(--interactive-normal)" }}>×</button>
        </div>
    );
}

function SettingsRow({ label, right }: { label: string; right: React.ReactNode; }) {
    return (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0" }}>
            <div style={{ opacity: .8 }}>{label}</div>
            <div>{right}</div>
        </div>
    );
}

function WhitelistModal({ modalProps }: { modalProps: ModalProps; }) {
    const [query, setQuery] = React.useState("");
    const [wl, setWl] = React.useState<string[]>(getWhitelist());
    const [includeGuilds, setIncludeGuilds] = React.useState<boolean>(settings.store.includeGuilds);
    const [includeGroupDMs, setIncludeGroupDMs] = React.useState<boolean>(settings.store.includeGroupDMs);

    const friendIds = RelationshipStore.getFriendIDs?.() ?? [];
    const dms = ChannelStore.getSortedPrivateChannels().filter(c => c.isDM?.());
    const candidateIds: string[] = React.useMemo(() => {
        const lower = query.toLowerCase();
        const base = (friendIds.length ? friendIds : dms.map(c => c.recipients?.[0]).filter(Boolean)) as string[];
        return base
            .filter(id => !wl.includes(id))
            .filter(id => {
                const u: any = UserStore.getUser(id);
                const name = (u?.globalName || u?.username || "").toLowerCase();
                return name.includes(lower);
            })
            .slice(0, 25);
    }, [query, wl, friendIds, dms]);

    function save() {
        setWhitelist(wl);
        settings.store.includeGuilds = includeGuilds;
        settings.store.includeGroupDMs = includeGroupDMs;
        modalProps.onClose();
    }

    async function start() {
        // persist
        setWhitelist(wl);
        settings.store.includeGuilds = includeGuilds;
        settings.store.includeGroupDMs = includeGroupDMs;

        const whitelistSet = new Set(wl);
        const myId = UserStore.getCurrentUser()?.id;
        if (!myId) {
            Toasts.show({ id: Toasts.genId(), type: Toasts.Type.FAILURE, message: "Could not determine current user." });
            return;
        }

        // Build target channel list
        const dmChannels = ChannelStore.getSortedPrivateChannels()
            .filter(c => typeof c.isDM === "function" ? c.isDM() : c.type === 1)
            .filter(c => {
                const recipientId = c.recipients?.[0];
                return recipientId && !whitelistSet.has(recipientId);
            });

        const groupDmChannels = includeGroupDMs ? ChannelStore.getSortedPrivateChannels()
            .filter(c => typeof c.isGroupDM === "function" ? c.isGroupDM() : c.type === 3)
            .filter(c => {
                const recips: string[] = (c.recipients || []).filter((id: string) => id !== myId);
                return recips.length > 0 && !recips.some(id => whitelistSet.has(id));
            }) : [];

        const guildTextChannels: any[] = [];
        if (includeGuilds) {
            const guilds = Object.values(GuildStore.getGuilds?.() || {} as Record<string, any>);
            for (const g of guilds) {
                const info: any = GuildChannelStore.getChannels?.(g.id);
                const selectable = info?.SELECTABLE || [];
                for (const item of selectable) {
                    const ch = item.channel || item; // compat
                    // 0 = GUILD_TEXT, 11/12 = threads, include threads too
                    if ([0, 11, 12].includes(ch?.type)) guildTextChannels.push(ch);
                }
            }
        }

        const targets = [...dmChannels, ...groupDmChannels, ...guildTextChannels];
        if (!targets.length) {
            Toasts.show({ id: Toasts.genId(), type: Toasts.Type.MESSAGE, message: "No channels to process." });
            modalProps.onClose();
            return;
        }

        Toasts.show({ id: Toasts.genId(), type: Toasts.Type.MESSAGE, message: `Processing ${targets.length} channels...` });

        const deleted: DeletedLogItem[] = [];
        let deletedCount = 0, failedCount = 0;

        // conservative delays to avoid rate limits
        const perDeleteDelayMs = 900 + Math.floor(Math.random() * 300);

        for (const ch of targets) {
            try {
                const messages = await fetchAllMessages(ch.id);
                const toDelete = messages.filter((m: any) => m?.author?.id === myId);
                for (const m of toDelete) {
                    try {
                        await MessageActions.deleteMessage(ch.id, m.id);
                        deletedCount++;
                        deleted.push({
                            channelId: ch.id,
                            guildId: ch.guild_id ?? null,
                            dmRecipientId: typeof ch.isDM === "function" && ch.isDM() ? ch.recipients?.[0] : null,
                            isGuild: !!ch.guild_id,
                            messageId: m.id,
                            timestamp: String(m.timestamp),
                            content: String(m.content ?? ""),
                            attachments: (m.attachments || []).map((a: any) => ({ filename: a.filename, url: a.url, content_type: a.content_type }))
                        });
                        await wait(perDeleteDelayMs);
                    } catch {
                        failedCount++;
                        // on 429 or generic error, slow down
                        await wait(perDeleteDelayMs + 1500);
                    }
                }
                // light pause between channels
                await wait(500);
            } catch {
                // ignore channel fetch errors
            }
        }

        // Build and save log
        const runId = new Date().toISOString().replace(/[:.]/g, "-");
        const body = {
            runId,
            startedAt: runId,
            finishedAt: new Date().toISOString(),
            userId: myId,
            includeGuilds,
            includeGroupDMs,
            whitelist: wl,
            stats: { deleted: deletedCount, failed: failedCount, channels: targets.length },
            deleted
        };

        const filename = `delete-log-${runId}.json`;
        try {
            if ((window as any).IS_DISCORD_DESKTOP) {
                const data = new TextEncoder().encode(JSON.stringify(body, null, 2));
                const savedPath = await (window as any).DiscordNative.fileManager.saveWithDialog(data, filename, "application/json");
                if (savedPath) {
                    settings.store.lastLogFilePath = savedPath;
                    Toasts.show({ id: Toasts.genId(), type: Toasts.Type.SUCCESS, message: `Saved log: ${filename}` });
                } else {
                    Toasts.show({ id: Toasts.genId(), type: Toasts.Type.FAILURE, message: "Log save canceled" });
                }
            } else {
                const blob = new Blob([JSON.stringify(body, null, 2)], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = filename;
                a.click();
                URL.revokeObjectURL(url);
                Toasts.show({ id: Toasts.genId(), type: Toasts.Type.SUCCESS, message: `Downloaded log: ${filename}` });
            }
        } catch {
            Toasts.show({ id: Toasts.genId(), type: Toasts.Type.FAILURE, message: "Failed to save log" });
        }

        Toasts.show({ id: Toasts.genId(), type: failedCount ? Toasts.Type.FAILURE : Toasts.Type.SUCCESS, message: `Done. Deleted ${deletedCount}${failedCount ? `, failed ${failedCount}` : ""}.` });
        modalProps.onClose();
    }

    return (
        <ModalRoot {...modalProps}>
            <ModalHeader>
                <div style={{ display: "flex", alignItems: "center", width: "100%" }}>
                    <h2 style={{ margin: 0 }}>Messages Scrapper</h2>
                    <div style={{ flex: 1 }} />
                    <ModalCloseButton onClick={modalProps.onClose} />
                </div>
            </ModalHeader>
            <ModalContent>
                <div style={{ marginBottom: 8 }}>Whitelist (kept users):</div>
                <div style={{ display: "flex", flexWrap: "wrap" }}>
                    {wl.map(id => <FriendTag key={id} id={id} onRemove={idToRemove => setWl(wl.filter(x => x !== idToRemove))} />)}
                </div>
                <div style={{ marginTop: 12, marginBottom: 6 }}>Add from your friends/DMs</div>
                <input
                    placeholder="Search users by name"
                    value={query}
                    onChange={e => setQuery((e.target as HTMLInputElement).value)}
                    style={{ width: "100%", padding: 8, borderRadius: 6, border: "1px solid var(--background-modifier-accent)" }}
                />
                <div style={{ marginTop: 8, maxHeight: 260, overflow: "auto" }}>
                    {candidateIds.map((id: string) => {
                        const u: any = id ? UserStore.getUser(id) : null;
                        const label = (u?.globalName || u?.username || id || "Unknown") as string;
                        const avatar = u?.getAvatarURL?.(undefined, 24, false);
                        return (
                            <div key={id} style={{ display: "flex", alignItems: "center", padding: 6, borderRadius: 6, gap: 8 }}>
                                {avatar && <img src={avatar} width={24} height={24} style={{ borderRadius: "50%" }} />}
                                <div style={{ flex: 1 }}>{label}</div>
                                <Button size={Button.Sizes.SMALL} onClick={() => setWl(uniq([...wl, id]))} disabled={!id}>Add</Button>
                            </div>
                        );
                    })}
                    {candidateIds.length === 0 && <div style={{ opacity: 0.7 }}>No matches</div>}
                </div>
                <div style={{ marginTop: 16 }}>
                    <SettingsRow label="Include server channels" right={<Button size={Button.Sizes.SMALL} onClick={() => setIncludeGuilds(!includeGuilds)}>{includeGuilds ? "Enabled" : "Disabled"}</Button>} />
                    <SettingsRow label="Include Group DMs" right={<Button size={Button.Sizes.SMALL} onClick={() => setIncludeGroupDMs(!includeGroupDMs)}>{includeGroupDMs ? "Enabled" : "Disabled"}</Button>} />
                </div>
            </ModalContent>
            <ModalFooter>
                <div style={{ display: "flex", justifyContent: "space-between", width: "100%" }}>
                    <Button onClick={save}>Save</Button>
                    <Button color={Button.Colors.RED} onClick={start}>Start</Button>
                </div>
            </ModalFooter>
        </ModalRoot>
    );
}

export default definePlugin({
    name: "MessagesScrapper",
    description: "Delete your own messages in DMs and servers except whitelisted users. Logs each run to JSON.",
    authors: [Devs.feelslove],
    settings,
    renderChatBarButton: ({ isMainChat }) => {
        if (!isMainChat) return null;
        return (
            <ChatBarButton
                tooltip="Messages Scrapper"
                onClick={() => openModal(props => <WhitelistModal modalProps={props} />)}
                onContextMenu={e =>
                    ContextMenuApi.openContextMenu(e, () => (
                        <Menu.Menu navId="pc-messages-scrapper-menu" onClose={ContextMenuApi.closeContextMenu} aria-label="Messages Scrapper">
                            <Menu.MenuItem id="pc-messages-scrapper-open" label="Open Messages Scrapper" action={() => openModal(props => <WhitelistModal modalProps={props} />)} />
                        </Menu.Menu>
                    ))
                }
            >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
                    <path fill="currentColor" d="M9 3h6a1 1 0 0 1 1 1v1h4v2H4V5h4V4a1 1 0 0 1 1-1Zm-3 6h12l-1 11a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 9Z" />
                </svg>
            </ChatBarButton>
        );
    }
});