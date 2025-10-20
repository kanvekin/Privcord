/*
 * Privcord - Friends Scrapper
 */

import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { openModal } from "@utils/modal";
import { classNameFactory } from "@utils/styles";
import { Button, RelationshipStore, Toasts, UserStore, RestAPI, React } from "@webpack/common";
import ErrorBoundary from "@components/ErrorBoundary";
import { ModalRoot, ModalHeader, ModalContent, ModalFooter, ModalCloseButton, ModalProps } from "@utils/modal";

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

// Patch Friends header to add a "Scrap" button on the "Friends" tab
// Borrowing the injection pattern used in ExportMessages
const FriendsHeaderPatch = {
    find: "[role=\"tab\"][aria-disabled=\"false\"]",
    replacement: {
        match: /(\"aria-label\":(\i).{0,25})(\i)\.Children\.map\((\i),this\.renderChildren\)/,
        replace:
            "$1($3 && $3.Children"
            + "? ($2 === 'Friends'"
            + "? [...$3.Children.map($4, this.renderChildren), $self.addScrapButton()]"
            + ": [...$3.Children.map($4, this.renderChildren)])"
            + ": $3.map($4, this.renderChildren))"
    }
} as const;

export default definePlugin({
    name: "FriendsScrapper",
    description: "Adds a Scrap button to Friends > All to unfriend everyone except whitelisted.",
    authors: [Devs.feelslove],
    settings,
    patches: [FriendsHeaderPatch],
    addScrapButton() {
        return <ErrorBoundary noop key=".pc-friends-scrapper">
            <Button size={Button.Sizes.SMALL} onClick={() => openModal(props => <WhitelistModal modalProps={props} />)}>
                Scrap
            </Button>
        </ErrorBoundary>;
    }
});
