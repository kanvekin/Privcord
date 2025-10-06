import "./checkNodeVersion.js";

import { execFileSync, execSync } from "child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { Readable } from "stream";
import { finished } from "stream/promises";
import { fileURLToPath } from "url";

const REPO = "Privcord";
const BASE_URL = `https://github.com/kanvekin/Privxe/releases/download/v1.0.1/`;

const BASE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const FILE_DIR = join(BASE_DIR, "dist", "Installer");
const ETAG_FILE = join(FILE_DIR, "etag.txt");

function getFilename() {
    switch (process.platform) {
        case "win32":
            return "PrivcordCli.exe";
        case "darwin":
            return "Privcord.MacOS.zip";
        case "linux":
            return "PrivcordCli-linux";
        default:
            throw new Error("Unsupported platform: " + process.platform);
    }
}

async function ensureBinary() {
    const filename = getFilename();
    console.log("Downloading " + filename);

    mkdirSync(FILE_DIR, { recursive: true });

    const downloadPath = join(FILE_DIR, filename);
    const outputFile = process.platform === "darwin"
        ? join(FILE_DIR, "Privcord")
        : downloadPath;

    const etag = existsSync(outputFile) && existsSync(ETAG_FILE)
        ? readFileSync(ETAG_FILE, "utf-8")
        : null;

    const res = await fetch(BASE_URL + filename, {
        headers: {
            "User-Agent": `Privcord Installer`,
            "If-None-Match": etag
        }
    });

    if (res.status === 304) {
        console.log("Up to date, not redownloading!");
        return outputFile;
    }
    if (!res.ok)
        throw new Error(`Failed to download installer: ${res.status} ${res.statusText}`);

    writeFileSync(ETAG_FILE, res.headers.get("etag"));

    if (process.platform === "darwin") {
        console.log("Unzipping...");
        const zip = new Uint8Array(await res.arrayBuffer());

        const ff = await import("fflate");
        const unzipped = ff.unzipSync(zip);
        const macosBinaryPath = Object.keys(unzipped).find(p =>
            p.endsWith("/Contents/MacOS/Privcord")
        );
        if (!macosBinaryPath) {
            throw new Error("macOS binary path not found in zip");
        }
        const bytes = unzipped[macosBinaryPath];

        writeFileSync(outputFile, bytes, { mode: 0o755 });

        const logAndRun = cmd => {
            console.log("Running", cmd);
            try {
                execSync(cmd);
            } catch (e) {
                console.warn("Command failed:", e.message);
            }
        };
        logAndRun(`sudo spctl --add '${outputFile}' --label "${REPO}"`);
        logAndRun(`sudo xattr -d com.apple.quarantine '${outputFile}'`);
    } else {
        const body = Readable.fromWeb(res.body);
        await finished(body.pipe(createWriteStream(outputFile, {
            mode: 0o755,
            autoClose: true
        })));
    }

    console.log("Finished downloading!");
    return outputFile;
}

const installerBin = await ensureBinary();

console.log("Now running Installer...");

const argStart = process.argv.indexOf("--");
const args = argStart === -1 ? [] : process.argv.slice(argStart + 1);

try {
    execFileSync(installerBin, args, {
        stdio: "inherit",
        env: {
            ...process.env,
            PRIVXE_USER_DATA_DIR: BASE_DIR,
            PRIVXE_INSTALL_DIR: join(BASE_DIR, "dist", "desktop"),
            PRIVXE_DEV_INSTALL: "1"
        }
    });
} catch (e) {
    console.error("Something went wrong. Please check the logs above.");
    console.error(e);
}
