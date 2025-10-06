/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2023 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import "./checkNodeVersion.js";

import { execFileSync, execSync } from "child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { Readable } from "stream";
import { finished } from "stream/promises";
import { fileURLToPath } from "url";

const DEFAULT_REPO = process.env.PRIVXE_INSTALLER_REPO || "kanvekin/Privcord";
const BASE_URL = `https://github.com/${DEFAULT_REPO}/releases/latest/download/`;
const INSTALLER_PATH_DARWIN = "Privxe.app/Contents/MacOS/Privxe";

const BASE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const FILE_DIR = join(BASE_DIR, "dist", "Installer");
const ETAG_FILE = join(FILE_DIR, "etag.txt");

function getFilename() {
    switch (process.platform) {
        case "win32":
            return "PrivxeCli.exe";        // Windows için .exe asset
        case "darwin":
            return "Privxe.MacOS.zip";      // macOS için zip (veya .dmg olursa değiştir)
        case "linux":
            return "PrivxeCli-linux";       // Linux için uygun ikili (örneğin AppImage ya da binary)
        default:
            throw new Error("Unsupported platform: " + process.platform);
    }
}

function getDisplayName() {
    switch (process.platform) {
        case "win32":
            return "PrivxeCli.exe";
        case "darwin":
            return "Privxe.MacOS.zip";
        case "linux":
            return "PrivxeCli-linux";
        default:
            return "Privxe Installer";
    }
}

function getCandidateAssetNames(platform, arch) {
    const candidates = [];
    const archHints = [arch, arch === "x64" ? "amd64" : arch, arch === "arm64" ? "aarch64" : arch].filter(Boolean);

    if (platform === "win32") {
        candidates.push(
            // Exact names we expect
            "PrivxeCli.exe",
            "Privcord.exe",
            "PrivcordCli.exe",
            "PrivxeInstaller.exe",
            "PrivcordInstaller.exe",
            // Common variations
            "Privxe-Installer.exe",
            "Privxe_Windows.exe",
            "Privxe-win.exe",
            "Privcord-win.exe"
        );
        for (const a of archHints) candidates.push(`PrivxeCli-${a}.exe`, `PrivcordCli-${a}.exe`);
    } else if (platform === "linux") {
        candidates.push(
            "PrivxeCli-linux",
            "PrivcordCli-linux",
            "PrivxeCli",
            "privxe",
            "privcord",
            "Privcord-x11"
        );
        for (const a of archHints) candidates.push(`PrivxeCli-linux-${a}`, `PrivcordCli-linux-${a}`);
    } else if (platform === "darwin") {
        candidates.push(
            "Privxe.MacOS.zip",
            "Privcord.MacOS.zip",
            "Privxe-macos.zip",
            "Privcord-macos.zip",
            "Privxe.dmg",
            "Privcord.dmg"
        );
        for (const a of archHints) candidates.push(`Privxe-macos-${a}.zip`, `Privcord-macos-${a}.zip`);
    }

    // Regex patterns to catch broader variations
    const regexPatterns = [];
    if (platform === "win32") {
        regexPatterns.push(/priv(x|c)ord.*(cli|setup|install).*\.exe$/i);
        regexPatterns.push(/priv(x|c)ord.*\.exe$/i);
    }
    if (platform === "linux") {
        regexPatterns.push(/priv(x|c)ord.*(cli|linux|x11|appimage|deb|rpm|tar|zip).*$/i);
        regexPatterns.push(/priv(x|c)ord.*$/i);
    }
    if (platform === "darwin") {
        regexPatterns.push(/priv(x|c)ord.*(mac|darwin|macos).*(zip|dmg)$/i);
        regexPatterns.push(/priv(x|c)ord.*\.(zip|dmg)$/i);
    }

    return { candidates, regexPatterns };
}

async function tryResolveAssetUrlFromApi() {
    const repo = DEFAULT_REPO;
    const apiUrl = `https://api.github.com/repos/${repo}/releases/latest`;
    const headers = {
        "User-Agent": "Privxe (https://github.com/kanvekin/Privxe)",
        "Accept": "application/vnd.github+json"
    };
    const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
    if (token) headers["Authorization"] = `Bearer ${token}`;

    let res;
    try {
        res = await fetch(apiUrl, { headers });
    } catch {
        return { url: null, assets: null };
    }
    if (!res.ok) return { url: null, assets: null };

    const json = await res.json();
    const assets = Array.isArray(json.assets) ? json.assets : [];

    const { candidates, regexPatterns } = getCandidateAssetNames(process.platform, process.arch);

    // 1) Try exact name match in order
    for (const name of candidates) {
        const asset = assets.find(a => a && typeof a.name === "string" && a.name === name);
        if (asset && asset.browser_download_url) return { url: asset.browser_download_url, assets };
    }

    // 2) Try regex patterns
    for (const pattern of regexPatterns) {
        const asset = assets.find(a => a && typeof a.name === "string" && pattern.test(a.name));
        if (asset && asset.browser_download_url) return { url: asset.browser_download_url, assets };
    }

    return { url: null, assets };
}

async function ensureBinary() {
    const filename = getFilename();
    const displayName = getDisplayName();
    console.log("Downloading " + displayName);

    mkdirSync(FILE_DIR, { recursive: true });

    const downloadName = join(FILE_DIR, filename);
    const outputFile = process.platform === "darwin"
        ? join(FILE_DIR, "Privxe")  // macOS için içinden çıkaracağımız ikili kısım
        : downloadName;

    const etag = existsSync(outputFile) && existsSync(ETAG_FILE)
        ? readFileSync(ETAG_FILE, "utf-8")
        : null;

    // Determine download URL with overrides and API discovery
    let downloadUrl = process.env.PRIVXE_INSTALLER_URL || null;
    let discoveredAssets = null;
    if (!downloadUrl) {
        const { url, assets } = await tryResolveAssetUrlFromApi();
        discoveredAssets = assets;
        downloadUrl = url || (BASE_URL + filename);
    }

    const res = await fetch(downloadUrl, {
        redirect: "follow",
        headers: {
            "User-Agent": "Privxe (https://github.com/kanvekin/Privxe)",
            "If-None-Match": etag || undefined
        }
    });

    if (res.status === 304) {
        console.log("Up to date, not redownloading!");
        return outputFile;
    }
    if (!res.ok) {
        let extra = "";
        if (res.status === 404) {
            const tried = downloadUrl;
            const suggestions = [
                "Check the latest release assets exist and names match your platform.",
                "Set PRIVXE_INSTALLER_URL to override the exact asset URL.",
                "Or set PRIVXE_INSTALLER_REPO (e.g. kanvekin/Privxe) if the repo differs."
            ];
            const assetList = (discoveredAssets || [])
                .map(a => (a && a.name ? `- ${a.name}` : null))
                .filter(Boolean)
                .join("\n");
            extra = `\nTried URL: ${tried}` +
                (assetList ? `\nAvailable assets from API:\n${assetList}` : "");
            extra += `\nHints:\n- ${suggestions.join("\n- ")}`;
        }
        throw new Error(`Failed to download installer: ${res.status} ${res.statusText}${extra}`);
    }

    writeFileSync(ETAG_FILE, res.headers.get("etag"));

    if (process.platform === "darwin") {
        console.log("Unzipping...");
        const zip = new Uint8Array(await res.arrayBuffer());

        const ff = await import("fflate");
        const unzipped = ff.unzipSync(zip);

        const expectedPaths = [
            INSTALLER_PATH_DARWIN,
            "Privcord.app/Contents/MacOS/Privcord"
        ];

        let bytes = null;
        for (const p of expectedPaths) {
            if (unzipped[p]) {
                bytes = unzipped[p];
                break;
            }
        }

        if (!bytes) {
            const keys = Object.keys(unzipped);
            const macBinCandidates = keys.filter(k => /\.app\/Contents\/MacOS\/.+/.test(k) && !k.endsWith("/"));
            if (macBinCandidates.length > 0) {
                const chosen = macBinCandidates[0];
                console.log(`Detected macOS binary inside zip: ${chosen}`);
                bytes = unzipped[chosen];
            }
        }

        if (!bytes) {
            const keys = Object.keys(unzipped).slice(0, 20).join(", ");
            throw new Error(`Could not locate macOS binary inside zip. Expected one of ${expectedPaths.join(" | ")}. Found entries: ${keys} ...`);
        }

        writeFileSync(outputFile, bytes, { mode: 0o755 });

        console.log("Overriding security policy for installer binary (this is required to run it)");
        console.log("xattr might error, that's okay");

        const logAndRun = cmd => {
            console.log("Running", cmd);
            try {
                execSync(cmd);
            } catch { }
        };
        logAndRun(`sudo spctl --add '${outputFile}' --label "Privxe"`);
        logAndRun(`sudo xattr -d com.apple.quarantine '${outputFile}'`);
    } else {
        // Non-macOS platformlarda direk indirme ve yazma
        const body = Readable.fromWeb(res.body);
        await finished(body.pipe(createWriteStream(outputFile, {
            mode: 0o755,
            autoClose: true
        })));
    }

    console.log("Finished downloading Privxe Installer!");

    return outputFile;
}

const installerBin = await ensureBinary();

console.log("Now running Privxe Installer...");

const argStart = process.argv.indexOf("--");
const args = argStart === -1 ? [] : process.argv.slice(argStart + 1);

try {
    execFileSync(installerBin, args, {
        stdio: "inherit",
        env: {
            ...process.env,
            PRIVXE_USER_DATA_DIR: BASE_DIR,
            PRIVXE_DIRECTORY: join(BASE_DIR, "dist/desktop"),
            PRIVXE_DEV_INSTALL: "1"
        }
    });
} catch (err) {
    console.error("Something went wrong. Please check the logs above.", err);
}
