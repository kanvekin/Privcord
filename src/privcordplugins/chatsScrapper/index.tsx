/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import { ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalProps, ModalRoot, openModal } from "@utils/modal";
import definePlugin, { OptionType } from "@utils/types";
import { Button, ChannelStore, ContextMenuApi, Menu, React, RestAPI, Toasts } from "@webpack/common";
import { ChatBarButton } from "@api/ChatButtons";

const settings = definePluginSettings({
    whitelist: {
        type: OptionType.STRING,
        description: "Comma-separated user IDs to keep (DM whitelist)",
        default: ""
    }
});

function parseCsv(csv: string): string[] {
    return csv.split(/[,.\s]+/).map(s => s.trim()).filter(Boolean);
}
function uniq(arr: string[]): string[] { return Array.from(new Set(arr)); }

function getWhitelist(): string[] { return uniq(parseCsv(settings.store.whitelist)); }
function setWhitelist(ids: string[]) { settings.store.whitelist = ids.join(","); }

function WhitelistModal({ modalProps }: { modalProps: ModalProps; }) {
    const [wl, setWl] = React.useState<string[]>(getWhitelist());
    const [query, setQuery] = React.useState("");

    const dms = ChannelStore.getSortedPrivateChannels().filter(c => c.isDM?.());
    const items = React.useMemo(() => {
        const lower = query.toLowerCase();
        return dms
            .filter(c => !wl.includes(c.recipients?.[0]))
            .filter(c => (c.name || "").toLowerCase().includes(lower))
            .slice(0, 30);
    }, [dms, query, wl]);

    async function start() {
        setWhitelist(wl);
        const whitelist = new Set(wl);

        const oneToOne = ChannelStore.getSortedPrivateChannels().filter(c => c.isDM?.());
        const toClose = oneToOne.filter(c => !whitelist.has(c.recipients?.[0]));

        if (toClose.length === 0) {
            Toasts.show({ id: Toasts.genId(), type: Toasts.Type.MESSAGE, message: "Nothing to close." });
            return;
        }

        Toasts.show({ id: Toasts.genId(), type: Toasts.Type.MESSAGE, message: `Closing ${toClose.length} DMs...` });
        let ok = 0, fail = 0;
        for (const ch of toClose) {
            try {
                await RestAPI.del({ url: `/channels/${ch.id}` });
                ok++;
            } catch {
                fail++;
            }
        }
        Toasts.show({ id: Toasts.genId(), type: fail ? Toasts.Type.FAILURE : Toasts.Type.SUCCESS, message: `Done. Closed ${ok}${fail ? `, failed ${fail}` : ""}.` });
        modalProps.onClose();
    }

    return (
        <ModalRoot {...modalProps}>
            <ModalHeader>
                <div style={{ display: "flex", alignItems: "center", width: "100%" }}>
                    <h2 style={{ margin: 0 }}>Chats Scrapper</h2>
                    <div style={{ flex: 1 }} />
                    <ModalCloseButton onClick={modalProps.onClose} />
                </div>
            </ModalHeader>
            <ModalContent>
                <div style={{ marginBottom: 8 }}>Whitelist (kept 1:1 DMs):</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {wl.map(id => <span key={id} style={{ background: "var(--background-secondary)", padding: "4px 8px", borderRadius: 6 }}>{id} <button onClick={() => setWl(wl.filter(x => x !== id))}>×</button></span>)}
                </div>
                <div style={{ marginTop: 12 }}>Add 1:1 DMs</div>
                <input placeholder="Search" value={query} onChange={e => setQuery((e.target as HTMLInputElement).value)} style={{ width: "100%", padding: 8, borderRadius: 6, border: "1px solid var(--background-modifier-accent)" }} />
                <div style={{ marginTop: 8, maxHeight: 260, overflow: "auto" }}>
                    {items.map(c => (
                        <div key={c.id} style={{ display: "flex", alignItems: "center", padding: 6, borderRadius: 6, gap: 8 }}>
                            <div style={{ flex: 1 }}>{c.name || c.recipients?.[0]}</div>
                            <Button size={Button.Sizes.SMALL} onClick={() => setWl(uniq([...wl, c.recipients?.[0]]))}>Add</Button>
                        </div>
                    ))}
                    {items.length === 0 && <div style={{ opacity: 0.7 }}>No matches</div>}
                </div>
            </ModalContent>
            <ModalFooter>
                <div style={{ display: "flex", justifyContent: "space-between", width: "100%" }}>
                    <Button onClick={() => { setWhitelist(wl); modalProps.onClose(); }}>Save</Button>
                    <Button color={Button.Colors.RED} onClick={start}>Start</Button>
                </div>
            </ModalFooter>
        </ModalRoot>
    );
}

// Quick action to start the chat scrapping process using the saved whitelist
async function startChatsScrape(): Promise<void> {
    const whitelist = new Set(getWhitelist());
    const oneToOne = ChannelStore.getSortedPrivateChannels().filter(c => c.isDM?.());
    const channelsToClose = oneToOne.filter(c => !whitelist.has(c.recipients?.[0]));

    if (channelsToClose.length === 0) {
        Toasts.show({ id: Toasts.genId(), type: Toasts.Type.MESSAGE, message: "Nothing to close." });
        return;
    }

    Toasts.show({ id: Toasts.genId(), type: Toasts.Type.MESSAGE, message: `Closing ${channelsToClose.length} DMs...` });
    let numClosedSuccessfully = 0;
    let numFailedToClose = 0;
    for (const channel of channelsToClose) {
        try {
            await RestAPI.del({ url: `/channels/${channel.id}` });
            numClosedSuccessfully++;
        } catch {
            numFailedToClose++;
        }
    }
    Toasts.show({
        id: Toasts.genId(),
        type: numFailedToClose ? Toasts.Type.FAILURE : Toasts.Type.SUCCESS,
        message: `Done. Closed ${numClosedSuccessfully}${numFailedToClose ? `, failed ${numFailedToClose}` : ""}.`
    });
}

// Menu icons
const PlayIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24">
        <path fill="currentColor" d="M8 5v14l11-7z" />
    </svg>
);

const EditIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24">
        <path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zm2.92 2.83H5v-.92l9.06-9.06.92.92L5.92 20.08zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
    </svg>
);

const TrashIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24">
        <path fill="currentColor" d="M9 3v1H4v2h16V4h-5V3H9zm1 6h2v8h-2V9zm-4 0h2v8H6V9zm8 0h2v8h-2V9z" />
    </svg>
);

const InfoIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24">
        <path fill="currentColor" d="M11 9h2V7h-2v2zm0 8h2v-6h-2v6zm1-14a10 10 0 1 0 0 20a10 10 0 0 0 0-20z" />
    </svg>
);

export default definePlugin({
    name: "ChatsScrapper",
    description: "Adds an × button near DM UI to close all 1:1 DMs except whitelist.",
    authors: [Devs.feelslove],
    settings,
    renderChatBarButton: ({ isMainChat }) => {
        if (!isMainChat) return null;
        return (
            <ChatBarButton
                tooltip="Chats Scrapper"
                onClick={() => openModal(props => <WhitelistModal modalProps={props} />)}
                onContextMenu={e =>
                    ContextMenuApi.openContextMenu(e, () => (
                        <Menu.Menu navId="pc-chats-scrapper-menu" onClose={ContextMenuApi.closeContextMenu} aria-label="Chats Scrapper">
                            <Menu.MenuGroup>
                                <Menu.MenuItem id="pc-chats-scrapper-open" label="Open Chats Scrapper" icon={EditIcon} action={() => openModal(props => <WhitelistModal modalProps={props} />)} />
                                <Menu.MenuItem id="pc-chats-scrapper-start" label="Start Scrape Now" icon={PlayIcon} action={startChatsScrape} />
                            </Menu.MenuGroup>
                            <Menu.MenuSeparator />
                            <Menu.MenuGroup>
                                <Menu.MenuItem id="pc-chats-scrapper-edit-whitelist" label="Edit Whitelist…" icon={EditIcon} action={() => openModal(props => <WhitelistModal modalProps={props} />)} />
                                <Menu.MenuItem id="pc-chats-scrapper-clear-whitelist" label="Clear Whitelist" icon={TrashIcon} action={() => { setWhitelist([]); Toasts.show({ id: Toasts.genId(), type: Toasts.Type.SUCCESS, message: "Whitelist cleared." }); }} />
                            </Menu.MenuGroup>
                            <Menu.MenuSeparator />
                            <Menu.MenuGroup>
                                <Menu.MenuItem id="pc-chats-scrapper-about" label="About Chats Scrapper" icon={InfoIcon} action={() => Toasts.show({ id: Toasts.genId(), type: Toasts.Type.MESSAGE, message: "Closes all 1:1 DMs except whitelisted. Use with caution." })} />
                            </Menu.MenuGroup>
                        </Menu.Menu>
                    ))
                }
            >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24">
                    <path fill="currentColor" d="M12 2a10 10 0 1 0 0 20a10 10 0 0 0 0-20Z" />
                </svg>
            </ChatBarButton>
        );
    }
});
