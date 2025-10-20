/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { classNameFactory } from "@api/Styles";

import { Devs } from "@utils/constants";
import { ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalProps, ModalRoot, openModal } from "@utils/modal";
import definePlugin, { OptionType } from "@utils/types";
import { Button, ContextMenuApi, Menu, React, RelationshipStore, RestAPI, Toasts, UserStore } from "@webpack/common";
import { ChatBarButton } from "@api/ChatButtons";

const cl = classNameFactory("pc-friends-scrapper-");

const settings = definePluginSettings({
    whitelist: {
        type: OptionType.STRING,
        description: "Comma-separated user IDs to keep (whitelist)",
        default: ""
    }
});

function parseCsv(csv: string): string[] {
    return csv
        .split(/[,\s]+/)
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

function FriendTag({ id, onRemove }: { id: string; onRemove: (id: string) => void; }) {
    const user = UserStore.getUser(id);
    if (!user) return null as any;
    return (
        <div className={cl("tag")} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 6px", background: "var(--background-secondary)", borderRadius: 6, marginRight: 6, marginBottom: 6 }}>
            <img src={user.getAvatarURL?.(undefined, 16, false)} width={16} height={16} style={{ borderRadius: "50%" }} />
            <span>{(user as any).globalName || user.username}</span>
            <button aria-label="remove" onClick={() => onRemove(id)} style={{ background: "transparent", border: 0, cursor: "pointer", color: "var(--interactive-normal)" }}>×</button>
        </div>
    );
}

function WhitelistModal({ modalProps }: { modalProps: ModalProps; }) {
    const [query, setQuery] = React.useState("");
    const [wl, setWl] = React.useState<string[]>(getWhitelist());

    const friendIds = RelationshipStore.getFriendIDs();
    const candidates = React.useMemo(() => {
        const lower = query.toLowerCase();
        return friendIds
            .filter(id => !wl.includes(id))
            .map(id => UserStore.getUser(id))
            .filter(Boolean)
            .filter((u: any) => ((u.globalName || u.username || "") as string).toLowerCase().includes(lower))
            .slice(0, 25);
    }, [query, wl, friendIds]);

    function save() {
        setWhitelist(wl);
        modalProps.onClose();
    }

    async function startScrap() {
        // Persist latest selection
        setWhitelist(wl);

        const whitelistSet = new Set(wl);
        const allFriends = RelationshipStore.getFriendIDs();
        const toRemove = allFriends.filter(id => !whitelistSet.has(id));

        if (!toRemove.length) {
            Toasts.show({ id: Toasts.genId(), type: Toasts.Type.MESSAGE, message: "Whitelist covers all friends. Nothing to remove." });
            return;
        }

        Toasts.show({ id: Toasts.genId(), type: Toasts.Type.MESSAGE, message: `Removing ${toRemove.length} friends...` });
        let success = 0, fail = 0;
        for (const id of toRemove) {
            try {
                await RestAPI.del({ url: `/users/@me/relationships/${id}` });
                success++;
            } catch {
                fail++;
            }
        }

        Toasts.show({ id: Toasts.genId(), type: fail ? Toasts.Type.FAILURE : Toasts.Type.SUCCESS, message: `Done. Removed ${success}${fail ? `, failed ${fail}` : ""}.` });
        modalProps.onClose();
    }

    return (
        <ModalRoot {...modalProps}>
            <ModalHeader>
                <div style={{ display: "flex", alignItems: "center", width: "100%" }}>
                    <h2 style={{ margin: 0 }}>Friends Scrapper</h2>
                    <div style={{ flex: 1 }} />
                    <ModalCloseButton onClick={modalProps.onClose} />
                </div>
            </ModalHeader>
            <ModalContent>
                <div style={{ marginBottom: 8 }}>Whitelist (kept friends):</div>
                <div style={{ display: "flex", flexWrap: "wrap" }}>
                    {wl.map(id => <FriendTag key={id} id={id} onRemove={idToRemove => setWl(wl.filter(x => x !== idToRemove))} />)}
                </div>
                <div style={{ marginTop: 12, marginBottom: 6 }}>Add from your friends</div>
                <input
                    placeholder="Search friends by name"
                    value={query}
                    onChange={e => setQuery((e.target as HTMLInputElement).value)}
                    style={{ width: "100%", padding: 8, borderRadius: 6, border: "1px solid var(--background-modifier-accent)" }}
                />
                <div style={{ marginTop: 8, maxHeight: 260, overflow: "auto" }}>
                    {candidates.map((u: any) => (
                        <div key={u.id} style={{ display: "flex", alignItems: "center", padding: 6, borderRadius: 6, gap: 8 }}>
                            <img src={u.getAvatarURL?.(undefined, 24, false)} width={24} height={24} style={{ borderRadius: "50%" }} />
                            <div style={{ flex: 1 }}>{u.globalName || u.username}</div>
                            <Button size={Button.Sizes.SMALL} onClick={() => setWl(uniq([...wl, u.id]))}>Add</Button>
                        </div>
                    ))}
                    {candidates.length === 0 && <div style={{ opacity: 0.7 }}>No matches</div>}
                </div>
            </ModalContent>
            <ModalFooter>
                <div style={{ display: "flex", justifyContent: "space-between", width: "100%" }}>
                    <Button onClick={save}>Save</Button>
                    <Button color={Button.Colors.RED} onClick={startScrap}>Start</Button>
                </div>
            </ModalFooter>
        </ModalRoot>
    );
}

// Quick action: start friends scrapping with the currently saved whitelist
async function startFriendsScrape(): Promise<void> {
    const whitelist = new Set(getWhitelist());
    const allFriends = RelationshipStore.getFriendIDs();
    const toRemove = allFriends.filter(id => !whitelist.has(id));

    if (toRemove.length === 0) {
        Toasts.show({ id: Toasts.genId(), type: Toasts.Type.MESSAGE, message: "Whitelist covers all friends. Nothing to remove." });
        return;
    }

    Toasts.show({ id: Toasts.genId(), type: Toasts.Type.MESSAGE, message: `Removing ${toRemove.length} friends...` });
    let success = 0, fail = 0;
    for (const id of toRemove) {
        try {
            await RestAPI.del({ url: `/users/@me/relationships/${id}` });
            success++;
        } catch {
            fail++;
        }
    }
    Toasts.show({ id: Toasts.genId(), type: fail ? Toasts.Type.FAILURE : Toasts.Type.SUCCESS, message: `Done. Removed ${success}${fail ? `, failed ${fail}` : ""}.` });
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
    name: "FriendsScrapper",
    description: "Adds a Scrap button to Friends > All to unfriend everyone except whitelisted.",
    authors: [Devs.feelslove],
    settings,
    renderChatBarButton: ({ isMainChat }) => {
        if (!isMainChat) return null;
        return (
            <ChatBarButton
                tooltip="Friends Scrapper"
                onClick={() => openModal(props => <WhitelistModal modalProps={props} />)}
                onContextMenu={e =>
                    ContextMenuApi.openContextMenu(e, () => (
                        <Menu.Menu navId="pc-friends-scrapper-menu" onClose={ContextMenuApi.closeContextMenu} aria-label="Friends Scrapper">
                            <Menu.MenuGroup>
                                <Menu.MenuItem id="pc-friends-scrapper-open" label="Open Friends Scrapper" icon={EditIcon} action={() => openModal(props => <WhitelistModal modalProps={props} />)} />
                                <Menu.MenuItem id="pc-friends-scrapper-start" label="Start Scrape Now" icon={PlayIcon} action={startFriendsScrape} />
                            </Menu.MenuGroup>
                            <Menu.MenuSeparator />
                            <Menu.MenuGroup>
                                <Menu.MenuItem id="pc-friends-scrapper-edit-whitelist" label="Edit Whitelist…" icon={EditIcon} action={() => openModal(props => <WhitelistModal modalProps={props} />)} />
                                <Menu.MenuItem id="pc-friends-scrapper-clear-whitelist" label="Clear Whitelist" icon={TrashIcon} action={() => { setWhitelist([]); Toasts.show({ id: Toasts.genId(), type: Toasts.Type.SUCCESS, message: "Whitelist cleared." }); }} />
                            </Menu.MenuGroup>
                            <Menu.MenuSeparator />
                            <Menu.MenuGroup>
                                <Menu.MenuItem id="pc-friends-scrapper-about" label="About Friends Scrapper" icon={InfoIcon} action={() => Toasts.show({ id: Toasts.genId(), type: Toasts.Type.MESSAGE, message: "Removes all friends except whitelisted. Use with caution." })} />
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
