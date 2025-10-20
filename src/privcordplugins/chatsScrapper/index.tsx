/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import { ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalProps, ModalRoot, openModal } from "@utils/modal";
import definePlugin, { OptionType } from "@utils/types";
import { Button, ChannelStore, ContextMenuApi, Menu, React, RestAPI, Toasts, UserStore } from "@webpack/common";
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

function DmUserTag({ id, onRemove }: { id: string; onRemove: (id: string) => void; }) {
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

function WhitelistModal({ modalProps }: { modalProps: ModalProps; }) {
    const [wl, setWl] = React.useState<string[]>(getWhitelist());
    const [query, setQuery] = React.useState("");

    const dms = ChannelStore.getSortedPrivateChannels().filter(c => c.isDM?.());
    const items = React.useMemo(() => {
        const lower = query.toLowerCase();
        return dms
            .filter(c => !wl.includes(c.recipients?.[0]))
            .filter(c => {
                const uid = c.recipients?.[0];
                const u: any = uid ? UserStore.getUser(uid) : null;
                const name = (u?.globalName || u?.username || c.name || "").toLowerCase();
                return name.includes(lower);
            })
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
                <div style={{ display: "flex", flexWrap: "wrap" }}>
                    {wl.map(id => <DmUserTag key={id} id={id} onRemove={idToRemove => setWl(wl.filter(x => x !== idToRemove))} />)}
                </div>
                <div style={{ marginTop: 12, marginBottom: 6 }}>Add from your DMs</div>
                <input
                    placeholder="Search users by name"
                    value={query}
                    onChange={e => setQuery((e.target as HTMLInputElement).value)}
                    style={{ width: "100%", padding: 8, borderRadius: 6, border: "1px solid var(--background-modifier-accent)" }}
                />
                <div style={{ marginTop: 8, maxHeight: 260, overflow: "auto" }}>
                    {items.map(c => {
                        const recipientId = c.recipients?.[0];
                        const u: any = recipientId ? UserStore.getUser(recipientId) : null;
                        const label = (u?.globalName || u?.username || c.name || recipientId || "Unknown") as string;
                        const avatar = u?.getAvatarURL?.(undefined, 24, false);
                        return (
                            <div key={c.id} style={{ display: "flex", alignItems: "center", padding: 6, borderRadius: 6, gap: 8 }}>
                                {avatar && <img src={avatar} width={24} height={24} style={{ borderRadius: "50%" }} />}
                                <div style={{ flex: 1 }}>{label}</div>
                                <Button size={Button.Sizes.SMALL} onClick={() => setWl(uniq([...wl, recipientId]))} disabled={!recipientId}>Add</Button>
                            </div>
                        );
                    })}
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
                            <Menu.MenuItem id="pc-chats-scrapper-open" label="Open Chats Scrapper" action={() => openModal(props => <WhitelistModal modalProps={props} />)} />
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
