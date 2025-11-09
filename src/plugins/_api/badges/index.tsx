/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./fixDiscordBadgePadding.css";

import { _getBadges, BadgePosition, BadgeUserArgs, ProfileBadge } from "@api/Badges";
import ErrorBoundary from "@components/ErrorBoundary";
import { openContributorModal } from "@components/settings/tabs";
import { isEquicordDonor, isPrivcordDonor } from "@components/settings/tabs/vencord";
import { Devs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import { copyWithToast, shouldShowContributorBadge, shouldShowEquicordContributorBadge, shouldShowPrivcordContributorBadge } from "@utils/misc";
import definePlugin from "@utils/types";
import { User } from "@vencord/discord-types";
import { ContextMenuApi, Menu, Toasts, UserStore } from "@webpack/common";
import { EquicordDonorModal, PrivcordDonorModal,VencordDonorModal } from "./modals";

const CONTRIBUTOR_BADGE = "https://cdn.discordapp.com/emojis/1092089799109775453.png?size=64";
const EQUICORD_CONTRIBUTOR_BADGE = "https://equicord.org/assets/favicon.png";
const PRIVCORD_CONTRIBUTOR_BADGE = "https://cdn.discordapp.com/emojis/1349141323705352222.webp?size=64";
const EQUICORD_DONOR_BADGE = "https://images.equicord.org/api/v1/files/raw/0199e71a-5555-7000-aafb-a07a355d9b28";
const PRIVCORD_DONOR_BADGE = "https://cdn.discordapp.com/emojis/1422406660281995264.webp?size=64";
const ContributorBadge: ProfileBadge = {
    description: "Vencord Contributor",
    image: CONTRIBUTOR_BADGE,
    position: BadgePosition.START,
    shouldShow: ({ userId }) => shouldShowContributorBadge(userId),
    onClick: (_, { userId }) => openContributorModal(UserStore.getUser(userId), "vencord")
};

const EquicordContributorBadge: ProfileBadge = {
    description: "Equicord Contributor",
    image: EQUICORD_CONTRIBUTOR_BADGE,
    position: BadgePosition.START,
    shouldShow: ({ userId }) => shouldShowEquicordContributorBadge(userId),
    onClick: (_, { userId }) => openContributorModal(UserStore.getUser(userId), "equicord"),
    props: {
        style: {
            borderRadius: "50%",
            transform: "scale(0.9)"
        }
    },
};

const UserPluginContributorBadge: ProfileBadge = {
    description: "User Plugin Contributor",
    image: USERPLUGIN_CONTRIBUTOR_BADGE,
    position: BadgePosition.START,
    shouldShow: ({ userId }) => {
        const allPlugins = Object.values(Plugins);
        return allPlugins.some(p => {
            const pluginMeta = PluginMeta[p.name];
            return pluginMeta?.userPlugin && p.authors.some(a => a.id.toString() === userId) && IS_DEV;
        });
    },
    onClick: (_, { userId }) => openContributorModal(UserStore.getUser(userId), "user"),
    props: {
        style: {
            borderRadius: "50%",
            transform: "scale(0.9)"
        }
    },
};

const PrivcordContributorBadge: ProfileBadge = {
    description: "Privcord Contributor",
    image: PRIVCORD_CONTRIBUTOR_BADGE,
    position: BadgePosition.START,
    shouldShow: ({ userId }) => shouldShowPrivcordContributorBadge(userId),
    onClick: (_, { userId }) => openContributorModal(UserStore.getUser(userId))
};

const EquicordDonorBadge: ProfileBadge = {
    description: "Equicord Donor",
    image: EQUICORD_DONOR_BADGE,
    position: BadgePosition.START,
    shouldShow: ({ userId }) => {
        const donorBadges = EquicordDonorBadges[userId]?.map(badge => badge.badge);
        const hasDonorBadge = donorBadges?.includes(EQUICORD_DONOR_BADGE);
        return isEquicordDonor(userId) && !hasDonorBadge;
    },
    onClick: () => EquicordDonorModal()
};

const PrivcordDonorBadge: ProfileBadge = {
    description: "Privcord Donor",
    image: PRIVCORD_DONOR_BADGE,
    position: BadgePosition.START,
    shouldShow: ({ userId }) => {
        const donorBadges = PrivcordDonorBadges[userId]?.map(badge => badge.badge);
        const hasDonorBadge = donorBadges?.includes(PRIVCORD_DONOR_BADGE);
        return isPrivcordDonor(userId) && !hasDonorBadge;
    },
    onClick: () => PrivcordDonorModal()
};
let DonorBadges = {} as Record<string, Array<Record<"tooltip" | "badge", string>>>;
let EquicordDonorBadges = {} as Record<string, Array<Record<"tooltip" | "badge", string>>>;
let PrivcordDonorBadges = {} as Record<string, Array<Record<"tooltip" | "badge", string>>>;

async function loadBadges(url: string, noCache = false) {
    const init = {} as RequestInit;
    if (noCache) init.cache = "no-cache";
    try {
        const response = await fetch(url, init);
        if (!response.ok) throw new Error(`Failed to fetch badges: ${response.status} ${response.statusText} (${url})`);
        const json = await response.json();
        if (!json || typeof json !== "object") {
            throw new Error(`Badges JSON is invalid (${url})`);
        }
        return json;
    } catch (err) {
        new Logger("BadgeAPI#loadBadges").error(err);
        return {};
    }
}

async function loadAllBadges(noCache = false) {
    const vencordBadges = await loadBadges("https://badges.vencord.dev/badges.json", noCache);
    const equicordBadges = await loadBadges("https://equicord.org/badges.json", noCache);
    const privcordBadges = await loadBadges("https://raw.githubusercontent.com/kanvekin/Donors/main/badges.json", noCache);

    DonorBadges = vencordBadges || {};
    EquicordDonorBadges = equicordBadges || {};
    PrivcordDonorBadges = privcordBadges || {};
}

let intervalId: any;

function BadgeContextMenu({ badge }: { badge: ProfileBadge & BadgeUserArgs; }) {
    return (
        <Menu.Menu navId="vc-badge-context" onClose={ContextMenuApi.closeContextMenu} aria-label="Badge Options">
            {badge.description && (
                <Menu.MenuItem id="vc-badge-copy-name" label="Copy Badge Name" action={() => copyWithToast(badge.description!)} />
            )}
            {badge.image && (
                <Menu.MenuItem id="vc-badge-copy-link" label="Copy Badge Image Link" action={() => copyWithToast(badge.image!)} />
            )}
        </Menu.Menu>
    );
}

export default definePlugin({
    name: "BadgeAPI",
    description: "API to add badges to users",
    authors: [Devs.Megu, Devs.Ven, Devs.TheSun, Devs.feelslove],
    required: true,
    patches: [
        {
            find: ".MODAL]:26",
            replacement: {
                match: /(?=;return 0===(\i)\.length\?)(?<=(\i)\.useMemo.+?)/,
                replace: ";$1=$2.useMemo(()=>[...$self.getBadges(arguments[0].displayProfile),...$1],[$1])"
            }
        },
        {
            find: "#{intl::PROFILE_USER_BADGES}",
            replacement: [
                {
                    match: /(alt:" ","aria-hidden":!0,src:)(.+?)(?=,)(?<=href:(\i)\.link.+?)/,
                    replace: (_, rest, originalSrc, badge) => `...${badge}.props,${rest}${badge}.image??(${originalSrc})`
                },
                {
                    match: /(?<="aria-label":(\i)\.description,.{0,200})children:/,
                    replace: "children:$1.component?$self.renderBadgeComponent({...$1}) :"
                },
                {
                    match: /href:(\i)\.link/,
                    replace: "...$self.getBadgeMouseEventHandlers($1),$&"
                }
            ]
        },
        {
            find: "profileCardUsernameRow,children:",
            replacement: {
                match: /badges:(\i)(?<=displayProfile:(\i).+?)/,
                replace: "badges:[...$self.getBadges($2),...$1]"
            }
        }
    ],

    get DonorBadges() {
        return DonorBadges;
    },
    get EquicordDonorBadges() {
        return EquicordDonorBadges;
    },
    get PrivcordDonorBadges() {
        return PrivcordDonorBadges;
    },

    toolboxActions: {
        async "Refetch Badges"() {
            await loadAllBadges(true);
            Toasts.show({
                id: Toasts.genId(),
                message: "Successfully refetched badges!",
                type: Toasts.Type.SUCCESS
            });
        }
    },
    userProfileBadges: [ContributorBadge, EquicordContributorBadge, PrivcordContributorBadge, EquicordDonorBadge, PrivcordDonorBadge],

    async start() {
        await loadAllBadges();
        clearInterval(intervalId);
        intervalId = setInterval(loadAllBadges, 1000 * 60 * 30);
    },

    async stop() {
        clearInterval(intervalId);
    },

    getBadges(props: { userId: string; user?: User; guildId: string; }) {
        if (!props) return [];

        try {
            props.userId ??= props.user?.id!;
            return _getBadges(props);
        } catch (e) {
            new Logger("BadgeAPI#hasBadges").error(e);
            return [];
        }
    },

    renderBadgeComponent: ErrorBoundary.wrap((badge: ProfileBadge & BadgeUserArgs) => {
        const Component = badge.component!;
        return <Component {...badge} />;
    }, { noop: true }),

    getBadgeMouseEventHandlers(badge: ProfileBadge & BadgeUserArgs) {
        const handlers = {} as Record<string, (e: React.MouseEvent) => void>;
        if (!badge) return handlers;

        const { onClick, onContextMenu } = badge;
        if (onClick) handlers.onClick = e => onClick(e, badge);
        if (onContextMenu) handlers.onContextMenu = e => onContextMenu(e, badge);
        return handlers;
    },

    getDonorBadges(userId: string) {
        return DonorBadges[userId]?.map(badge => ({
            image: badge.badge,
            description: badge.tooltip,
            position: BadgePosition.START,
            props: { style: { borderRadius: "50%", transform: "scale(0.9)" } },
            onContextMenu(event, badge) {
                ContextMenuApi.openContextMenu(event, () => <BadgeContextMenu badge={badge} />);
            },
            onClick: () => VencordDonorModal()
        } satisfies ProfileBadge));
    },

    getEquicordDonorBadges(userId: string) {
        return EquicordDonorBadges[userId]?.map(badge => ({
            image: badge.badge,
            description: badge.tooltip,
            position: BadgePosition.START,
            props: { style: { borderRadius: "50%", transform: "scale(0.9)" } },
            onContextMenu(event, badge) {
                ContextMenuApi.openContextMenu(event, () => <BadgeContextMenu badge={badge} />);
            },
            onClick: () => EquicordDonorModal()
        } satisfies ProfileBadge));
    },

    getPrivcordDonorBadges(userId: string) {
        return PrivcordDonorBadges[userId]?.map(badge => ({
            image: badge.badge,
            description: badge.tooltip,
            position: BadgePosition.START,
            props: { style: { borderRadius: "50%", transform: "scale(0.9)" } },
            onContextMenu(event, badge) {
                ContextMenuApi.openContextMenu(event, () => <BadgeContextMenu badge={badge} />);
            },
            onClick: () => PrivcordDonorModal()
        } satisfies ProfileBadge));
    }
});
