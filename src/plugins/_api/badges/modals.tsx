/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Flex } from "@components/Flex";
import { Heart } from "@components/Heart";
import { DonateButton, ErrorBoundary, HeadingPrimary, Paragraph, VCDonateButton } from "@components/index";
import { Margins } from "@utils/margins";
import { closeModal, ModalContent, ModalFooter, ModalHeader, ModalRoot, openModal } from "@utils/modal";
import { Forms } from "@webpack/common";

export function VencordDonorModal() {
    const modalKey = openModal(props => (
        <ErrorBoundary noop onError={() => {
            closeModal(modalKey);
            VencordNative.native.openExternal("https://github.com/sponsors/Vendicated");
        }}>
            <ModalRoot {...props}>
                <ModalHeader>
                    <HeadingPrimary
                        style={{
                            width: "100%",
                            textAlign: "center",
                            margin: 0
                        }}
                    >
                        <Flex style={{ justifyContent: "center", alignItems: "center", gap: "0.5em" }}>
                            <Heart />
                            Vencord Donor
                        </Flex>
                    </HeadingPrimary>
                </ModalHeader>
                <ModalContent>
                    <Flex>
                        <img
                            role="presentation"
                            src="https://cdn.discordapp.com/emojis/1026533070955872337.png"
                            alt=""
                            style={{ margin: "auto" }}
                        />
                        <img
                            role="presentation"
                            src="https://cdn.discordapp.com/emojis/1026533090627174460.png"
                            alt=""
                            style={{ margin: "auto" }}
                        />
                    </Flex>
                    <div style={{ padding: "1em" }}>
                        <Paragraph>
                            This Badge is a special perk for Vencord Donors
                        </Paragraph>
                        <Paragraph className={Margins.top20}>
                            Please consider supporting the development of Vencord by becoming a donor. It would mean a lot!!
                        </Paragraph>
                    </div>
                </ModalContent>
                <ModalFooter>
                    <Flex style={{ width: "100%", justifyContent: "center" }}>
                        <VCDonateButton />
                    </Flex>
                </ModalFooter>
            </ModalRoot>
        </ErrorBoundary>
    ));
}

export function EquicordDonorModal() {
    const modalKey = openModal(props => (
        <ErrorBoundary noop onError={() => {
            closeModal(modalKey);
            // Will get my own in the future
            VencordNative.native.openExternal("https://github.com/sponsors/thororen1234");
        }}>
            <ModalRoot {...props}>
                <ModalHeader>
                    <HeadingPrimary
                        style={{
                            width: "100%",
                            textAlign: "center",
                            margin: 0
                        }}
                    >
                        <Flex style={{ justifyContent: "center", alignItems: "center", gap: "0.5em" }}>
                            <Heart />
                            Kernixcord Donor
                        </Flex>
                    </HeadingPrimary>
                </ModalHeader>
                <ModalContent>
                    <Flex>
                        <img
                            role="presentation"
                            src="https://cdn.discordapp.com/emojis/1026533070955872337.png"
                            alt=""
                            style={{ margin: "auto" }}
                        />
                        <img
                            role="presentation"
                            src="https://cdn.discordapp.com/emojis/1026533090627174460.png"
                            alt=""
                            style={{ margin: "auto" }}
                        />
                    </Flex>
                    <div style={{ padding: "1em" }}>
                        <Forms.FormText>
                            This badge is a special perk for Kernixcord donors.
                        </Forms.FormText>
                        <Forms.FormText className={Margins.top20}>
                            Please consider supporting the development of Kernixcord by becoming a donor. It would mean a lot! :3
                        </Forms.FormText>
                    </div>
                </ModalContent>
                <ModalFooter>
                    <Flex style={{ width: "100%", justifyContent: "center" }}>
                        <DonateButton />
                    </Flex>
                </ModalFooter>
            </ModalRoot>
        </ErrorBoundary>
    ));
}

export function KernixcordDonorModal() {
    const modalKey = openModal(props => (
        <ErrorBoundary noop onError={() => {
            closeModal(modalKey);
            // Will get my own in the future
            VencordNative.native.openExternal("https://github.com/sponsors/kanvekin");
        }}>
            <ModalRoot {...props}>
                <ModalHeader>
                    <Flex style={{ width: "100%", justifyContent: "center" }}>
                        <Forms.FormTitle
                            tag="h2"
                            style={{
                                width: "100%",
                                textAlign: "center",
                                margin: 0
                            }}
                        >
                            <Heart />
                            Kernixcord Donor
                        </Forms.FormTitle>
                    </Flex>
                </ModalHeader>
                <ModalContent>
                    <Flex>
                        <img
                            role="presentation"
                            src="https://cdn.discordapp.com/emojis/1026533070955872337.png"
                            alt=""
                            style={{ margin: "auto" }}
                        />
                        <img
                            role="presentation"
                            src="https://cdn.discordapp.com/emojis/1026533090627174460.png"
                            alt=""
                            style={{ margin: "auto" }}
                        />
                    </Flex>
                    <div style={{ padding: "1em" }}>
                        <Forms.FormText>
                            This badge is a special perk for Kernixcord donors.
                        </Forms.FormText>
                        <Forms.FormText className={Margins.top20}>
                            Please consider supporting the development of Kernixcord by becoming a donor. It would mean a lot! :3
                        </Forms.FormText>
                    </div>
                </ModalContent>
                <ModalFooter>
                    <Flex style={{ width: "100%", justifyContent: "center" }}>
                        <DonateButton />
                    </Flex>
                </ModalFooter>
            </ModalRoot>
        </ErrorBoundary>
    ));
}
