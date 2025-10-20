/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import { ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalProps, ModalRoot,openModal } from "@utils/modal";
import definePlugin, { OptionType } from "@utils/types";
import { Button, ChannelStore, Menu, React,RestAPI, Toasts } from "@webpack/common";

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

const dmContextPatch = (children: Array<React.ReactElement | null>) => {
    if (!children.some(c => (c as any)?.props?.id === "pc-chats-scrapper")) {
        children.unshift(
            <Menu.MenuItem id="pc-chats-scrapper" label="×" action={() => openModal(props => <WhitelistModal modalProps={props} />)} />
        );
    }
};

export default definePlugin({
    name: "ChatsScrapper",
    description: "Adds an × button near DM UI to close all 1:1 DMs except whitelist.",
    authors: [Devs.feelslove],
    settings,
    contextMenus: {
        "channel-context": dmContextPatch,
        "gdm-context": _c => null // do not add for groups
    }
});
