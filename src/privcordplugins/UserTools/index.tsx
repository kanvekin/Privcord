/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings, useSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { Devs } from "@utils/constants";
import { classes } from "@utils/misc";
import definePlugin, { OptionType } from "@utils/types";
import type { Channel, User } from "@vencord/discord-types";
import { findByPropsLazy, findComponentByCodeLazy } from "@webpack";
import {
    ChannelStore,
    GuildMemberStore,
    Menu,
    PermissionsBits,
    PermissionStore,
    React,
    RestAPI,
    Toasts,
    UserStore,
    VoiceStateStore
} from "@webpack/common";
import type { PropsWithChildren, ReactNode, SVGProps } from "react";

const HeaderBarIcon = findComponentByCodeLazy(".HEADER_BAR_BADGE_TOP:", '.iconBadge,"top"');

interface BaseIconProps extends IconProps {
    viewBox: string;
}

interface IconProps extends SVGProps<SVGSVGElement> {
    className?: string;
    height?: string | number;
    width?: string | number;
}

function Icon({
    height = 24,
    width = 24,
    className,
    children,
    viewBox,
    ...svgProps
}: PropsWithChildren<BaseIconProps>) {
    return (
        <svg
            className={classes(className, "vc-icon")}
            role="img"
            width={width}
            height={height}
            viewBox={viewBox}
            {...svgProps}
        >
            {children}
        </svg>
    );
}

function DisconnectIcon(props: IconProps) {
    return (
        <Icon {...props} viewBox="0 0 24 24">
            <path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
        </Icon>
    );
}

function MuteIcon(props: IconProps) {
    return (
        <Icon {...props} viewBox="0 0 24 24">
            <path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm0-12c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm0 6c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z" />
        </Icon>
    );
}

function DeafenIcon(props: IconProps) {
    return (
        <Icon {...props} viewBox="0 0 24 24">
            <path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z" />
        </Icon>
    );
}

interface VoiceState {
    userId: string;
    channelId?: string;
    oldChannelId?: string;
    deaf: boolean;
    mute: boolean;
    selfDeaf: boolean;
    selfMute: boolean;
    selfStream: boolean;
    selfVideo: boolean;
    sessionId: string;
    suppress: boolean;
    requestToSpeakTimestamp: string | null;
}

interface UserActions {
    disconnect: boolean;
    mute: boolean;
    deafen: boolean;
}

export const settings = definePluginSettings({
    userActions: {
        type: OptionType.STRING,
        description: "JSON object mapping user IDs to their actions (disconnect, mute, deafen)",
        restartNeeded: false,
        hidden: true,
        default: "{}",
    },
});

const Auth: { getToken: () => string; } = findByPropsLazy("getToken");

function getUserActions(userId: string): UserActions {
    try {
        const actions = JSON.parse(settings.store.userActions || "{}");
        return actions[userId] || { disconnect: false, mute: false, deafen: false };
    } catch {
        return { disconnect: false, mute: false, deafen: false };
    }
}

function setUserActions(userId: string, actions: UserActions) {
    try {
        const allActions = JSON.parse(settings.store.userActions || "{}");
        if (actions.disconnect || actions.mute || actions.deafen) {
            allActions[userId] = actions;
        } else {
            delete allActions[userId];
        }
        settings.store.userActions = JSON.stringify(allActions);
    } catch (e) {
        console.error("Failed to save user actions:", e);
    }
}

async function disconnectGuildMember(guildId: string, userId: string) {
    const token = Auth?.getToken?.();
    if (!token) return false;

    try {
        const response = await RestAPI.patch({
            url: `/guilds/${guildId}/members/${userId}`,
            body: { channel_id: null }
        });

        return response.ok !== false;
    } catch {
        return false;
    }
}

async function muteGuildMember(guildId: string, userId: string, mute: boolean) {
    const token = Auth?.getToken?.();
    if (!token) return false;

    try {
        const response = await RestAPI.patch({
            url: `/guilds/${guildId}/members/${userId}`,
            body: { mute }
        });

        return response.ok !== false;
    } catch {
        return false;
    }
}

async function deafenGuildMember(guildId: string, userId: string, deaf: boolean) {
    const token = Auth?.getToken?.();
    if (!token) return false;

    try {
        const response = await RestAPI.patch({
            url: `/guilds/${guildId}/members/${userId}`,
            body: { deaf }
        });

        return response.ok !== false;
    } catch {
        return false;
    }
}

function getGuildIdFromChannel(channelId: string): string | null {
    const channel = ChannelStore.getChannel(channelId);
    if (!channel) return null;
    return (channel as any).guild_id ?? (channel as any).guildId ?? null;
}

interface UserContextProps {
    channel: Channel;
    guildId?: string;
    user: User;
}

const UserContext: NavContextMenuPatchCallback = (children, { user, guildId }: UserContextProps) => {
    if (!user || user.id === UserStore.getCurrentUser().id) return;
    if (!guildId) return; // Only work in guilds

    const actions = getUserActions(user.id);
    const hasAnyAction = actions.disconnect || actions.mute || actions.deafen;

    children.splice(-1, 0, (
        <Menu.MenuGroup key="user-tools-group">
            <Menu.MenuItem
                id="user-tools-header"
                label="UserTools"
                disabled={true}
            />
            <Menu.MenuItem
                id="user-tools-disconnect"
                label="Bağlantı kes"
                action={() => {
                    const newActions = { ...actions, disconnect: !actions.disconnect };
                    setUserActions(user.id, newActions);
                    if (newActions.disconnect) {
                        const channel = VoiceStateStore.getVoiceStateForUser(user.id)?.channelId;
                        if (channel) {
                            const gId = getGuildIdFromChannel(channel);
                            if (gId) void disconnectGuildMember(gId, user.id);
                        }
                    }
                }}
                checked={actions.disconnect}
                showCheckbox={true}
            />
            <Menu.MenuItem
                id="user-tools-mute"
                label="Sunucuda Sustur"
                action={() => {
                    const newActions = { ...actions, mute: !actions.mute };
                    setUserActions(user.id, newActions);
                    if (newActions.mute) {
                        const channel = VoiceStateStore.getVoiceStateForUser(user.id)?.channelId;
                        if (channel) {
                            const gId = getGuildIdFromChannel(channel);
                            if (gId) void muteGuildMember(gId, user.id, true);
                        }
                    } else if (guildId) {
                        void muteGuildMember(guildId, user.id, false);
                    }
                }}
                checked={actions.mute}
                showCheckbox={true}
            />
            <Menu.MenuItem
                id="user-tools-deafen"
                label="Sunucuda Sağırlaştır"
                action={() => {
                    const newActions = { ...actions, deafen: !actions.deafen };
                    setUserActions(user.id, newActions);
                    if (newActions.deafen) {
                        const channel = VoiceStateStore.getVoiceStateForUser(user.id)?.channelId;
                        if (channel) {
                            const gId = getGuildIdFromChannel(channel);
                            if (gId) void deafenGuildMember(gId, user.id, true);
                        }
                    } else if (guildId) {
                        void deafenGuildMember(guildId, user.id, false);
                    }
                }}
                checked={actions.deafen}
                showCheckbox={true}
            />
        </Menu.MenuGroup>
    ));
};

export default definePlugin({
    name: "UserTools",
    description: "Adds context menu options to continuously disconnect, mute, or deafen users in guilds",
    authors: [Devs.feelslove],

    settings,

    patches: [
        {
            find: "toolbar:function",
            replacement: {
                match: /(function \i\(\i\){)(.{1,200}toolbar.{1,100}mobileToolbar)/,
                replace: "$1$self.addIconToToolBar(arguments[0]);$2"
            }
        },
    ],

    contextMenus: {
        "user-context": UserContext
    },

    flux: {
        VOICE_STATE_UPDATES({ voiceStates }: { voiceStates: VoiceState[]; }) {
            try {
                const allActions = JSON.parse(settings.store.userActions || "{}");

                for (const { userId, channelId, oldChannelId } of voiceStates) {
                    const actions = allActions[userId] as UserActions | undefined;
                    if (!actions || (!actions.disconnect && !actions.mute && !actions.deafen)) continue;

                    const channel = channelId ? ChannelStore.getChannel(channelId) : null;
                    if (!channel) continue;
                    const guildId = getGuildIdFromChannel(channelId!);
                    if (!guildId) continue;

                    // Check permissions
                    const canMove = PermissionStore.can(PermissionsBits.MOVE_MEMBERS, channel);
                    const canMute = PermissionStore.can(PermissionsBits.MUTE_MEMBERS, channel);
                    const canDeafen = PermissionStore.can(PermissionsBits.DEAFEN_MEMBERS, channel);

                    if (actions.disconnect && channelId && canMove) {
                        // User joined a voice channel, disconnect them
                        void disconnectGuildMember(guildId, userId);
                    }

                    // Continuously apply mute/deafen
                    const voiceState = VoiceStateStore.getVoiceStateForUser(userId);
                    if (voiceState) {
                        if (actions.mute && canMute && !voiceState.mute) {
                            void muteGuildMember(guildId, userId, true);
                        }
                        if (actions.deafen && canDeafen && !voiceState.deaf) {
                            void deafenGuildMember(guildId, userId, true);
                        }
                    }
                }
            } catch (e) {
                console.error("UserTools: Error in VOICE_STATE_UPDATES:", e);
            }
        },
    },

    UserToolsIndicator() {
        try {
            const allActions = JSON.parse(settings.store.userActions || "{}");
            const activeUsers = Object.keys(allActions).filter(userId => {
                const actions = allActions[userId] as UserActions;
                return actions && (actions.disconnect || actions.mute || actions.deafen);
            });

            if (activeUsers.length === 0) return null;

            const firstUser = UserStore.getUser(activeUsers[0]);
            const tooltip = activeUsers.length === 1
                ? `UserTools: ${firstUser?.username ?? activeUsers[0]} (right-click to disable)`
                : `UserTools: ${activeUsers.length} active users (right-click to disable)`;

            return (
                <HeaderBarIcon
                    tooltip={tooltip}
                    icon={DisconnectIcon}
                    onClick={() => { }}
                    onContextMenu={e => {
                        e.preventDefault();
                        settings.store.userActions = "{}";
                        Toasts.show({
                            message: "All UserTools actions disabled",
                            id: Toasts.genId(),
                            type: Toasts.Type.SUCCESS
                        });
                    }}
                />
            );
        } catch {
            return null;
        }
    },

    addIconToToolBar(e: { toolbar: ReactNode[] | ReactNode; }) {
        const icon = (
            <ErrorBoundary noop={true} key="user-tools-indicator">
                <this.UserToolsIndicator />
            </ErrorBoundary>
        );

        if (Array.isArray(e.toolbar)) {
            e.toolbar.push(icon);
        } else {
            e.toolbar = [icon, e.toolbar];
        }
    },
});
