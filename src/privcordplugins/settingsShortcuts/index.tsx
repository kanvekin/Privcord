/*
 * Vencord/Privcord - Settings Shortcuts
 * Adds two buttons in Discord settings to open Better Microphone and Better Screenshare modals.
 */

import definePlugin from "@utils/types";
import { Button } from "@webpack/common";

import { openMicrophoneSettingsModal } from "../betterMicrophone.desktop/modals";
import { openScreenshareModal } from "../betterScreenshare.desktop/modals";

const SettingsShortcutsElement = () => (
    <div style={{ display: "flex", gap: "0.5rem" }}>
        <Button
            size={Button.Sizes.SMALL}
            color={Button.Colors.PRIMARY}
            onClick={openMicrophoneSettingsModal}
        >
            {"Better Microphone Ayarları"}
        </Button>
        <Button
            size={Button.Sizes.SMALL}
            color={Button.Colors.PRIMARY}
            onClick={openScreenshareModal}
        >
            {"Better Screenshare Ayarları"}
        </Button>
    </div>
);

export default definePlugin({
    name: "SettingsShortcuts",
    description: "Discord ayarlarına Better Microphone ve Better Screenshare kısayol butonları ekler.",
    authors: [],
    start() {
        const customSettingsSections = (
            Vencord.Plugins.plugins.Settings as any as {
                customSections: ((ID: Record<string, unknown>) => any)[];
            }
        ).customSections;

        const sectionFactory = () => ({
            section: "privcord.settings-shortcuts",
            label: "Privcord Shortcuts",
            searchableTitles: ["Privcord Shortcuts", "Better Microphone", "Better Screenshare"],
            element: SettingsShortcutsElement,
            id: "PrivcordSettingsShortcuts",
        });

        customSettingsSections.push(sectionFactory);
    },
    stop() {
        const customSettingsSections = (
            Vencord.Plugins.plugins.Settings as any as {
                customSections: ((ID: Record<string, unknown>) => any)[];
            }
        ).customSections;

        const i = customSettingsSections.findIndex(
            section => section({}).id === "PrivcordSettingsShortcuts"
        );
        if (i !== -1) customSettingsSections.splice(i, 1);
    },
});


