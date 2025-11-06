/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { LogIcon } from "@components/Icons";
import { findByCodeLazy, findByPropsLazy, findComponentByCodeLazy, findLazy, findStoreLazy } from "@webpack";
import { GuildStore, UserStore, useStateFromStores } from "@webpack/common";

const React = findLazy(m => m.useState && m.useEffect);

const PageWrapper = findComponentByCodeLazy("forumOrHome]:null");
const mainClasses = findByPropsLazy("chat", "threadSidebarOpen");
const headerClasses = findByPropsLazy("header", "innerHeader", "tabBar");

const { selectFilterPopout } = findByPropsLazy("selectFilterPopout");
const { elevationBorderHigh } = findByPropsLazy("elevationBorderHigh");

const { SearchableQuickSelect } = findByPropsLazy("SearchableQuickSelect");

const getAuditLogComponent = () => {
    try {
        // Try to get from patched property first
        const props = findByPropsLazy("vcAuditLogComponent");
        if (props?.vcAuditLogComponent) {
            return props.vcAuditLogComponent;
        }
        // Fallback: try to find audit log component by code pattern
        // This is the component that renders audit logs in Discord's settings
        const auditLogComponent = findComponentByCodeLazy("showLoadMore", "logs.length");
        return auditLogComponent || null;
    } catch (error) {
        console.error("Error finding audit log component:", error);
        return null;
    }
};

const GuildSettingsAuditLogStore = findStoreLazy("GuildSettingsAuditLogStore");
const ThemeStore = findStoreLazy("ThemeStore");
const StreamerModeStore = findStoreLazy("StreamerModeStore");

const logsParser = findByCodeLazy("AUTO_MODERATION_ADD_KEYWORDS:case");

const { Title, Icon } = findLazy(m => ["Icon", "Title", "Divider", "Caret"].every(i => Object.prototype.hasOwnProperty.call(m, i)));

export default function AuditLogPage({ guildId }: { guildId: string; }) {
    const guild = useStateFromStores([GuildStore], () => GuildStore.getGuild(guildId));

    const theme = useStateFromStores([ThemeStore], () => ThemeStore.theme);
    const streamerMode = useStateFromStores([StreamerModeStore], () => StreamerModeStore.enabled);
    const logs = useStateFromStores([GuildSettingsAuditLogStore], () => GuildSettingsAuditLogStore?.logs);

    const [AuditLog, setAuditLog] = React.useState<any>(null);

    React.useEffect(() => {
        // Try to get the component, with retry in case patch hasn't run yet
        const component = getAuditLogComponent();
        if (component) {
            setAuditLog(component);
            return;
        }
        // Retry after a short delay in case the patch needs time
        const timeout = setTimeout(() => {
            const retryComponent = getAuditLogComponent();
            if (retryComponent) {
                setAuditLog(retryComponent);
            }
        }, 100);
        return () => clearTimeout(timeout);
    }, []);

    if (!AuditLog) {
        return <div className={mainClasses.chat}>
            <PageWrapper
                className={headerClasses.header}
                innerClassName={headerClasses.innerHeader}
                hideSearch={true}
                channelId="audit-log"
                guildId={guildId}
                toolbar={[]}
            >
                <Icon icon={LogIcon} />
                <Title>Audit Log</Title>
            </PageWrapper>
            <div style={{ padding: "20px", textAlign: "center" }}>Loading audit log...</div>
        </div>;
    }

    if (!GuildSettingsAuditLogStore) {
        return <div className={mainClasses.chat}>
            <PageWrapper
                className={headerClasses.header}
                innerClassName={headerClasses.innerHeader}
                hideSearch={true}
                channelId="audit-log"
                guildId={guildId}
                toolbar={[]}
            >
                <Icon icon={LogIcon} />
                <Title>Audit Log</Title>
            </PageWrapper>
            <div style={{ padding: "20px", textAlign: "center" }}>Audit log store not available</div>
        </div>;
    }

    const moderators = ((GuildSettingsAuditLogStore.userIds && Array.isArray(GuildSettingsAuditLogStore.userIds)) 
        ? GuildSettingsAuditLogStore.userIds 
        : []).map((e: string) => UserStore.getUser(e)).filter((i: any) => i !== null);
    
    let parsedLogs: any[] = [];
    try {
        if (logs !== null && logs !== undefined && guild !== null && logsParser) {
            parsedLogs = logsParser(logs, guild) || [];
        }
    } catch (error) {
        console.error("Error parsing audit logs:", error);
        parsedLogs = [];
    }

    return <div className={mainClasses.chat}>
        <PageWrapper
            className={headerClasses.header}
            innerClassName={headerClasses.innerHeader}
            hideSearch={true}
            channelId="audit-log"
            guildId={guildId}
            toolbar={[
            ]}
        >
            <Icon icon={LogIcon} />
            <Title>Audit Log</Title>
        </PageWrapper>
        <AuditLog
            guildId={guildId}
            guild={guild}
            moderators={moderators}
            isInitialLoading={GuildSettingsAuditLogStore.isInitialLoading ?? false}
            isLoading={GuildSettingsAuditLogStore.isLoading ?? false}
            isLoadingNextPage={GuildSettingsAuditLogStore.isLoadingNextPage ?? false}
            showLoadMore={(GuildSettingsAuditLogStore.groupedFetchCount ?? 0) > 2}
            hasError={GuildSettingsAuditLogStore.hasError ?? false}
            hasOlderLogs={GuildSettingsAuditLogStore.hasOlderLogs ?? false}
            logs={parsedLogs}
            actionFilter={GuildSettingsAuditLogStore.actionFilter ?? null}
            userIdFilter={GuildSettingsAuditLogStore.userIdFilter ?? null}
            theme={theme}
            hide={streamerMode ?? false}
        />
    </div>;
}
