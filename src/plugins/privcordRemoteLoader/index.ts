/*
 * Privcord Remote Loader
 * Dynamically loads remote Privcord plugins at runtime without rebuilding the client.
 *
 * Remote plugin format:
 * - Serve a browser-ready JS file (IIFE/UMD) that calls
 *   window.PrivcordRemote.register(<pluginObject>).
 * - <pluginObject> must conform to Vencord Plugin interface (definePlugin({...}) output works too).
 * - Patches may not apply if their target code already initialized; prefer non-patch plugins.
 */

import { Settings as SettingsApi } from "@api/Settings";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType, Plugin } from "@utils/types";
import gitRemote from "~git-remote";

// Avoid circular dependency by lazy requiring
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PluginsModule = () => require("plugins") as typeof import("../../plugins");

type Manifest = {
    plugins: Array<{
        name: string;
        url: string;
        enabledByDefault?: boolean;
    }>;
};

const logger = new Logger("PrivcordRemoteLoader");

declare global {
    interface Window {
        PrivcordRemote?: {
            register(p: Plugin): void;
        };
    }
}

function getDefaultManifestUrl(): string {
    const remote = gitRemote || "kanvekin/Privcord";
    // Expected path in repo: remote-plugins/manifest.json
    return `https://raw.githubusercontent.com/${remote}/main/remote-plugins/manifest.json`;
}

async function fetchJson<T>(url: string): Promise<T> {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
    return await res.json() as T;
}

function ensureRemoteBridge(onRegister: (p: Plugin) => void) {
    if (!window.PrivcordRemote) {
        window.PrivcordRemote = {
            register(p: Plugin) {
                try {
                    onRegister(p);
                } catch (e) {
                    logger.error("Failed to register remote plugin", p?.name, e);
                }
            }
        };
    }
}

async function loadRemoteScript(url: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        const s = document.createElement("script");
        s.src = url;
        s.async = true;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error(`Failed to load script ${url}`));
        document.head.appendChild(s);
    });
}

export default definePlugin({
    name: "PrivcordRemoteLoader",
    description: "Loads remote Privcord plugins at runtime from a manifest URL.",
    authors: [],
    hidden: true,
    required: true,
    enabledByDefault: true,
    settings: {
        def: {
            manifestUrl: {
                type: OptionType.STRING,
                description: "Manifest URL (JSON)",
                default: getDefaultManifestUrl()
            },
            autoStart: {
                type: OptionType.BOOLEAN,
                description: "Auto-start loaded remote plugins",
                default: true
            }
        }
    },

    async start() {
        const { startPlugin, startDependenciesRecursive } = PluginsModule();
        const settings = SettingsApi.plugins.PrivcordRemoteLoader as unknown as {
            manifestUrl: string; autoStart: boolean;
        };

        const loaded = new Set<string>();

        const onRegister = (p: Plugin) => {
            if (!p?.name || loaded.has(p.name)) return;

            // Ensure dependencies are enabled first
            const { failures, restartNeeded } = startDependenciesRecursive(p);
            if (failures.length) {
                logger.warn("Failed to start some dependencies for", p.name, failures);
            }

            // Add into registry
            (Vencord.Plugins.plugins as Record<string, Plugin>)[p.name] = p;
            loaded.add(p.name);

            // Enable in settings and start
            const sp = SettingsApi.plugins as any;
            sp[p.name] ??= {};
            sp[p.name].enabled = true;

            if (settings.autoStart && !restartNeeded) {
                try {
                    startPlugin(p);
                } catch (e) {
                    logger.error("Failed to start remote plugin", p.name, e);
                }
            }
        };

        ensureRemoteBridge(onRegister);

        try {
            const manifest = await fetchJson<Manifest>(settings.manifestUrl || getDefaultManifestUrl());
            for (const entry of manifest.plugins) {
                try {
                    await loadRemoteScript(entry.url);
                } catch (e) {
                    logger.error("Failed to load remote plugin script", entry.url, e);
                }
            }
        } catch (e) {
            logger.error("Failed to load remote manifest", e);
        }
    },

    stop() {
        // Best-effort: does not unload remote scripts; users can disable remote plugins individually.
    }
});
