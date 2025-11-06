/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { Devs } from "@utils/constants";
import { ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalProps, ModalRoot, openModal } from "@utils/modal";
import definePlugin, { OptionType } from "@utils/types";
import { Button, ChannelStore, Constants, GuildStore, React, RestAPI, SelectedChannelStore, Toasts, UserStore } from "@webpack/common";
import { findComponentByCodeLazy, findByPropsLazy } from "@webpack";

const DeleteMessageStore = findByPropsLazy("deleteMessage");
const HeaderBarIcon = findComponentByCodeLazy(".HEADER_BAR_BADGE_TOP:", '.iconBadge,"top"');

const settings = definePluginSettings({
    delay: {
        type: OptionType.NUMBER,
        description: "Delay between deletions (ms)",
        default: 1000
    },
    batchSize: {
        type: OptionType.NUMBER,
        description: "Batch size for deletions",
        default: 1
    }
});

interface DiscordAPIError {
    status: number;
    body?: {
        retry_after?: number;
    };
    message?: string;
}

async function fetchAllMessages(channelId: string): Promise<any[]> {
    const result: any[] = [];
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

function UndiscordIcon() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
        </svg>
    );
}

function UndiscordModal({ modalProps, channelId }: { modalProps: ModalProps; channelId: string; }) {
    const [authorId, setAuthorId] = React.useState("");
    const [serverId, setServerId] = React.useState("");
    const [channelIdFilter, setChannelIdFilter] = React.useState("");
    const [isDeleting, setIsDeleting] = React.useState(false);
    const [progress, setProgress] = React.useState({ deleted: 0, total: 0 });

    const channel = ChannelStore.getChannel(channelId);
    const currentGuildId = channel?.guild_id || channel?.guildId || "";

    React.useEffect(() => {
        // Channel ID'yi sadece başlangıçta doldur, kullanıcı boşaltabilir
        if (channelIdFilter === "" && channelId) {
            setChannelIdFilter(channelId);
        }
        // Server ID'yi sadece başlangıçta doldur, kullanıcı boşaltabilir
        if (serverId === "" && currentGuildId) {
            setServerId(currentGuildId);
        }
    }, [channelId, currentGuildId]);

    async function getAllChannels(): Promise<string[]> {
        const channels: string[] = [];
        const targetServerId = serverId.trim();
        const targetChannelId = channelIdFilter.trim();

        // Eğer channel ID belirtilmişse, sadece o kanalı kullan
        if (targetChannelId) {
            channels.push(targetChannelId);
            return channels;
        }

        // Eğer server ID belirtilmişse, sadece o sunucudaki kanalları kullan
        if (targetServerId) {
            const guildChannels = ChannelStore.getMutableGuildChannelsForGuild(targetServerId);
            Object.values(guildChannels).forEach((channel: any) => {
                // Sadece text kanalları ve thread'leri ekle
                if (channel && (channel.type === 0 || channel.type === 5 || channel.type === 11 || channel.type === 12)) {
                    channels.push(channel.id);
                }
            });
            return channels;
        }

        // Eğer ikisi de boşsa, TÜM kanalları al
        // 1. Tüm DM'leri ekle
        const privateChannels = ChannelStore.getSortedPrivateChannels();
        privateChannels.forEach(channel => {
            if (channel && (channel.type === 1 || channel.type === 3)) { // DM veya Group DM
                channels.push(channel.id);
            }
        });

        // 2. Tüm sunuculardaki text kanallarını ekle
        const guilds = GuildStore.getGuilds();
        Object.values(guilds).forEach((guild: any) => {
            if (!guild || !guild.id) return;

            const guildChannels = ChannelStore.getMutableGuildChannelsForGuild(guild.id);
            Object.values(guildChannels).forEach((channel: any) => {
                // Text kanalları, forum kanalları, thread'ler
                if (channel && (channel.type === 0 || channel.type === 5 || channel.type === 11 || channel.type === 12)) {
                    channels.push(channel.id);
                }
            });
        });

        return channels;
    }

    async function handleDelete() {
        if (isDeleting) return;

        const targetAuthorId = authorId.trim();
        const targetServerId = serverId.trim();
        const targetChannelId = channelIdFilter.trim();

        // Author ID boşsa, kullanıcının kendi ID'sini kullan
        const currentUser = UserStore.getCurrentUser();
        const authorIdToUse = targetAuthorId || currentUser?.id;

        if (!authorIdToUse) {
            Toasts.show({ id: Toasts.genId(), type: Toasts.Type.FAILURE, message: "Author ID is required!" });
            return;
        }

        setIsDeleting(true);
        setProgress({ deleted: 0, total: 0 });

        try {
            Toasts.show({ id: Toasts.genId(), type: Toasts.Type.MESSAGE, message: "Getting all channels..." });
            const channels = await getAllChannels();

            if (channels.length === 0) {
                Toasts.show({ id: Toasts.genId(), type: Toasts.Type.MESSAGE, message: "No channels found!" });
                setIsDeleting(false);
                return;
            }

            Toasts.show({ id: Toasts.genId(), type: Toasts.Type.MESSAGE, message: `Scanning ${channels.length} channels...` });

            // Tüm kanallardan mesajları topla
            const allMessages: Array<{ channelId: string; message: any; }> = [];

            for (let i = 0; i < channels.length; i++) {
                const channelId = channels[i];
                try {
                    const messages = await fetchAllMessages(channelId);
                    // Sadece kullanıcının mesajlarını filtrele
                    const userMessages = messages.filter(m => m.author?.id === authorIdToUse);
                    userMessages.forEach(msg => {
                        allMessages.push({ channelId, message: msg });
                    });

                    // Progress update
                    setProgress({ deleted: 0, total: allMessages.length });
                } catch (error) {
                    console.error(`[Undiscord] Failed to fetch messages from channel ${channelId}:`, error);
                }
            }

            if (allMessages.length === 0) {
                Toasts.show({ id: Toasts.genId(), type: Toasts.Type.MESSAGE, message: "No messages to delete!" });
                setIsDeleting(false);
                return;
            }

            setProgress({ deleted: 0, total: allMessages.length });
            Toasts.show({ id: Toasts.genId(), type: Toasts.Type.MESSAGE, message: `Deleting ${allMessages.length} messages from ${channels.length} channels...` });

            let deleted = 0;
            let failed = 0;
            const delay = settings.store.delay || 1000;

            for (const { channelId, message } of allMessages) {
                try {
                    await DeleteMessageStore.deleteMessage(channelId, message.id);
                    deleted++;
                    setProgress({ deleted, total: allMessages.length });

                    if (deleted % settings.store.batchSize === 0) {
                        await new Promise(resolve => setTimeout(resolve, delay));
                    }
                } catch (error: any) {
                    const discordError = error as DiscordAPIError;

                    if (discordError?.status === 429) {
                        const retryAfter = discordError.body?.retry_after || 5;
                        Toasts.show({
                            id: Toasts.genId(),
                            type: Toasts.Type.MESSAGE,
                            message: `Rate limited. Waiting ${retryAfter}s...`
                        });
                        await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
                        // Retry the same message
                        try {
                            await DeleteMessageStore.deleteMessage(channelId, message.id);
                            deleted++;
                            setProgress({ deleted, total: allMessages.length });
                        } catch (retryError) {
                            failed++;
                            console.error("[Undiscord] Failed to delete message after retry:", retryError);
                        }
                        continue;
                    } else if (discordError?.status === 404) {
                        deleted++;
                        setProgress({ deleted, total: allMessages.length });
                    } else {
                        failed++;
                        console.error("[Undiscord] Failed to delete message:", error);
                    }
                }
            }

            Toasts.show({
                id: Toasts.genId(),
                type: failed > 0 ? Toasts.Type.FAILURE : Toasts.Type.SUCCESS,
                message: `Deleted ${deleted} messages from ${channels.length} channels${failed > 0 ? `, ${failed} failed` : ""}.`
            });

            modalProps.onClose();
        } catch (error) {
            console.error("[Undiscord] Error:", error);
            Toasts.show({ id: Toasts.genId(), type: Toasts.Type.FAILURE, message: "Failed to delete messages!" });
        } finally {
            setIsDeleting(false);
        }
    }

    return (
        <ModalRoot {...modalProps} size="medium">
            <ModalHeader>
                <div style={{ display: "flex", alignItems: "center", width: "100%" }}>
                    <h2 style={{ margin: 0 }}>Undiscord - Delete Messages</h2>
                    <div style={{ flex: 1 }} />
                    <ModalCloseButton onClick={modalProps.onClose} />
                </div>
            </ModalHeader>
            <ModalContent>
                <div style={{ marginBottom: 16 }}>
                    <div style={{
                        marginBottom: 8,
                        color: "var(--text-normal)",
                        fontWeight: 600,
                        fontSize: "14px",
                        display: "flex",
                        alignItems: "center",
                        gap: 8
                    }}>
                        Author ID (optional):
                        <Button
                            size={Button.Sizes.TINY}
                            onClick={() => {
                                const currentUser = UserStore.getCurrentUser();
                                if (currentUser) {
                                    setAuthorId(currentUser.id);
                                    Toasts.show({
                                        id: Toasts.genId(),
                                        type: Toasts.Type.SUCCESS,
                                        message: "Author ID set to your user ID"
                                    });
                                }
                            }}
                            disabled={isDeleting}
                            style={{
                                height: "20px",
                                padding: "0 8px",
                                fontSize: "11px"
                            }}
                        >
                            Click
                        </Button>
                    </div>
                    <input
                        type="text"
                        placeholder="Leave empty to delete all messages"
                        value={authorId}
                        onChange={e => setAuthorId(e.target.value)}
                        style={{
                            width: "100%",
                            padding: "10px 12px",
                            borderRadius: 8,
                            border: "1px solid var(--background-modifier-accent)",
                            background: "var(--input-background)",
                            color: "var(--text-normal)",
                            fontSize: "14px",
                            outline: "none"
                        }}
                        disabled={isDeleting}
                    />
                    <div style={{
                        marginTop: 4,
                        fontSize: "12px",
                        color: "var(--text-muted)"
                    }}>
                        Leave empty to delete your own messages from all channels
                    </div>
                </div>

                <div style={{ marginBottom: 16 }}>
                    <div style={{
                        marginBottom: 8,
                        color: "var(--text-normal)",
                        fontWeight: 600,
                        fontSize: "14px",
                        display: "flex",
                        alignItems: "center",
                        gap: 8
                    }}>
                        Server ID (optional):
                        {currentGuildId && (
                            <Button
                                size={Button.Sizes.TINY}
                                onClick={() => {
                                    setServerId(currentGuildId);
                                    Toasts.show({
                                        id: Toasts.genId(),
                                        type: Toasts.Type.SUCCESS,
                                        message: "Server ID set to current server"
                                    });
                                }}
                                disabled={isDeleting}
                                style={{
                                    height: "20px",
                                    padding: "0 8px",
                                    fontSize: "11px"
                                }}
                            >
                                Click
                            </Button>
                        )}
                    </div>
                    <input
                        type="text"
                        placeholder="Leave empty or use current server"
                        value={serverId}
                        onChange={e => setServerId(e.target.value)}
                        style={{
                            width: "100%",
                            padding: "10px 12px",
                            borderRadius: 8,
                            border: "1px solid var(--background-modifier-accent)",
                            background: "var(--input-background)",
                            color: "var(--text-normal)",
                            fontSize: "14px",
                            outline: "none"
                        }}
                        disabled={isDeleting}
                    />
                    <div style={{
                        marginTop: 4,
                        fontSize: "12px",
                        color: "var(--text-muted)"
                    }}>
                        Leave empty to search all servers
                    </div>
                </div>

                <div style={{ marginBottom: 16 }}>
                    <div style={{
                        marginBottom: 8,
                        color: "var(--text-normal)",
                        fontWeight: 600,
                        fontSize: "14px",
                        display: "flex",
                        alignItems: "center",
                        gap: 8
                    }}>
                        Channel ID:
                        <Button
                            size={Button.Sizes.TINY}
                            onClick={() => {
                                setChannelIdFilter(channelId);
                                Toasts.show({
                                    id: Toasts.genId(),
                                    type: Toasts.Type.SUCCESS,
                                    message: "Channel ID set to current channel"
                                });
                            }}
                            disabled={isDeleting}
                            style={{
                                height: "20px",
                                padding: "0 8px",
                                fontSize: "11px"
                            }}
                        >
                            Click
                        </Button>
                    </div>
                    <input
                        type="text"
                        placeholder="Channel ID to delete messages from"
                        value={channelIdFilter}
                        onChange={e => setChannelIdFilter(e.target.value)}
                        style={{
                            width: "100%",
                            padding: "10px 12px",
                            borderRadius: 8,
                            border: "1px solid var(--background-modifier-accent)",
                            background: "var(--input-background)",
                            color: "var(--text-normal)",
                            fontSize: "14px",
                            outline: "none"
                        }}
                        disabled={isDeleting}
                    />
                    <div style={{
                        marginTop: 4,
                        fontSize: "12px",
                        color: "var(--text-muted)"
                    }}>
                        Leave empty to search all channels (DM + all servers)
                    </div>
                </div>

                {isDeleting && progress.total > 0 && (
                    <div style={{
                        marginTop: 16,
                        padding: "12px",
                        background: "var(--background-secondary)",
                        borderRadius: 8,
                        border: "1px solid var(--background-modifier-accent)"
                    }}>
                        <div style={{
                            marginBottom: 8,
                            color: "var(--text-normal)",
                            fontWeight: 600,
                            fontSize: "14px"
                        }}>
                            Progress: {progress.deleted} / {progress.total}
                        </div>
                        <div style={{
                            width: "100%",
                            height: "8px",
                            background: "var(--background-modifier-accent)",
                            borderRadius: 4,
                            overflow: "hidden"
                        }}>
                            <div style={{
                                width: `${(progress.deleted / progress.total) * 100}%`,
                                height: "100%",
                                background: "var(--brand-experiment)",
                                transition: "width 0.3s ease"
                            }} />
                        </div>
                    </div>
                )}

                <div style={{
                    marginTop: 16,
                    padding: "12px",
                    background: "var(--background-modifier-hover)",
                    borderRadius: 8,
                    border: "1px solid var(--background-modifier-accent)"
                }}>
                    <div style={{
                        color: "var(--text-warning)",
                        fontSize: "12px",
                        fontWeight: 600,
                        marginBottom: 4
                    }}>
                        ⚠️ Warning
                    </div>
                    <div style={{
                        color: "var(--text-muted)",
                        fontSize: "12px"
                    }}>
                        This action cannot be undone. Make sure you want to delete these messages. Using automation tools may result in account termination.
                    </div>
                </div>
            </ModalContent>
            <ModalFooter>
                <div style={{
                    display: "flex",
                    justifyContent: "space-between",
                    width: "100%",
                    gap: "12px"
                }}>
                    <Button
                        onClick={modalProps.onClose}
                        disabled={isDeleting}
                        style={{
                            background: "var(--background-modifier-hover)",
                            color: "var(--text-normal)",
                            border: "1px solid var(--background-modifier-accent)"
                        }}
                    >
                        Cancel
                    </Button>
                    <Button
                        color={Button.Colors.RED}
                        onClick={handleDelete}
                        disabled={isDeleting}
                        style={{
                            background: "var(--button-danger-background)",
                            color: "var(--white-500)"
                        }}
                    >
                        {isDeleting ? "Deleting..." : "Delete"}
                    </Button>
                </div>
            </ModalFooter>
        </ModalRoot>
    );
}

function UndiscordButton() {
    const channelId = SelectedChannelStore.getChannelId();
    const channel = channelId ? ChannelStore.getChannel(channelId) : null;

    if (!channelId || !channel) return null;

    return (
        <HeaderBarIcon
            className="vc-undiscord-btn"
            onClick={() => openModal(props => <UndiscordModal modalProps={props} channelId={channelId} />)}
            tooltip="Undiscord - Delete Messages"
            icon={UndiscordIcon}
        />
    );
}

export default definePlugin({
    name: "Undiscord",
    description: "Delete all messages in a Discord channel or DM. Bulk delete messages with filters by Author ID, Server ID, and Channel ID.",
    authors: [Devs.feelslove],
    settings,
    patches: [
        {
            find: ".controlButtonWrapper,",
            replacement: {
                match: /(function \i\(\i\){)(.{1,200}toolbar.{1,100}mobileToolbar)/,
                replace: "$1$self.addIconToToolBar(arguments[0]);$2"
            }
        }
    ],
    addIconToToolBar(e: { toolbar: any[] | any; }) {
        if (Array.isArray(e.toolbar)) {
            // MessageLoggerEnhanced'ın butonundan sonra ekle
            const logsButtonIndex = e.toolbar.findIndex((item: any) =>
                item?.props?.className === "vc-log-toolbox-btn" ||
                (item?.type?.displayName === "OpenLogsButton")
            );

            if (logsButtonIndex !== -1) {
                e.toolbar.splice(logsButtonIndex + 1, 0,
                    <ErrorBoundary noop={true} key="undiscord-button">
                        <UndiscordButton />
                    </ErrorBoundary>
                );
            } else {
                // Eğer logs butonu yoksa, en başa ekle
                e.toolbar.unshift(
                    <ErrorBoundary noop={true} key="undiscord-button">
                        <UndiscordButton />
                    </ErrorBoundary>
                );
            }
        } else {
            e.toolbar = [
                <ErrorBoundary noop={true} key="undiscord-button">
                    <UndiscordButton />
                </ErrorBoundary>,
                e.toolbar
            ];
        }
    }
});
