/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { DonateButton } from "@components/settings";
import { PRIVCORD_DONOR_ROLE_ID, PRIVCORD_GUILD_ID } from "@utils/constants";
import { Button, GuildMemberStore } from "@webpack/common";
import BadgeAPI from "plugins/_api/badges";

export const isDonor = (userId: string) => !!(
    BadgeAPI.getDonorBadges(userId)?.length > 0
    || GuildMemberStore.getMember(PRIVCORD_GUILD_ID, userId)?.roles.includes(PRIVCORD_DONOR_ROLE_ID)
);

export function DonateButtonComponent() {
    return (
        <DonateButton
            look={Button.Looks.FILLED}
            color={Button.Colors.WHITE}
            style={{ marginTop: "1em" }}
        />
    );
}
