const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {EXECUTION} = require("./paths");

const PREFIX = "bdeploy1.";
const ENV_PATH = path.join(EXECUTION, ".env");
const PASSPHRASE =
    "15ef9e69998bee61a5a0094b0ce917f7fe71c49c3637d833de2524bf60ecc3cd";
const SALT = Buffer.from("57cc728ece0c2a5746ffcf10769bd21d", "hex");
const PBKDF2_ITERS = 210_000;

function deriveKey() {
    return crypto.pbkdf2Sync(PASSPHRASE, SALT, PBKDF2_ITERS, 32, "sha256");
}

function normalizeKey(raw) {
    const hex = String(raw)
        .trim()
        .replace(/^0x/i, "");
    if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
        throw new Error("PRIVATE_KEY must be 32-byte hex (with or without 0x)");
    }
    return `0x${hex.toLowerCase()}`;
}

function isWrapped(value) {
    return typeof value === "string" && value.trim().startsWith(PREFIX);
}

function wrap(rawKey) {
    const plaintext = Buffer.from(normalizeKey(rawKey), "utf8");
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", deriveKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return PREFIX + Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

function unwrap(blob) {
    const value = String(blob).trim();
    if (!value.startsWith(PREFIX)) {
        throw new Error(
            "PRIVATE_KEY in .env must be a bdeploy-wrapped blob (use --wrap-key)"
        );
    }
    const buf = Buffer.from(value.slice(PREFIX.length), "base64");
    if (buf.length < 12 + 16 + 1) {
        throw new Error("PRIVATE_KEY wrapped blob is truncated");
    }
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const ciphertext = buf.subarray(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", deriveKey(), iv);
    decipher.setAuthTag(tag);
    try {
        return normalizeKey(
            Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
                "utf8"
            )
        );
    } catch (err) {
        throw new Error("failed to unwrap PRIVATE_KEY (wrong salt/blob)");
    }
}

function resolveSignerKey({dryRun} = {}) {
    const stored = process.env.PRIVATE_KEY;
    if (!stored || !stored.trim()) {
        if (dryRun) {
            return null;
        }
        throw new Error(
            `PRIVATE_KEY missing (set wrapped blob in ${ENV_PATH} or pass --dry-run)`
        );
    }
    if (!isWrapped(stored)) {
        throw new Error(
            "plaintext PRIVATE_KEY refused; wrap it with: node bdeploy/cli.js --wrap-key"
        );
    }
    return unwrap(stored);
}

function upsertEnvPrivateKey(wrapped) {
    let body = "";
    if (fs.existsSync(ENV_PATH)) {
        body = fs.readFileSync(ENV_PATH, "utf8");
    }
    const line = `PRIVATE_KEY=${wrapped}`;
    if (/(^|\n)PRIVATE_KEY=/.test(body)) {
        body = body.replace(/(^|\n)PRIVATE_KEY=.*(?=\n|$)/, `$1${line}`);
        if (!body.endsWith("\n")) {
            body += "\n";
        }
    } else {
        body = body && !body.endsWith("\n") ? `${body}\n${line}\n` : `${body}${line}\n`;
    }
    fs.writeFileSync(ENV_PATH, body);
    fs.chmodSync(ENV_PATH, 0o600);
    return ENV_PATH;
}

function wrapKeyFromArgv(argv) {
    const idx = argv.indexOf("--wrap-key");
    if (idx < 0) {
        return false;
    }
    const next = argv[idx + 1];
    let raw;
    if (next && !next.startsWith("--")) {
        raw = next;
    } else if (
        process.env.PRIVATE_KEY &&
        !isWrapped(process.env.PRIVATE_KEY)
    ) {
        raw = process.env.PRIVATE_KEY;
    } else if (!process.stdin.isTTY) {
        raw = fs.readFileSync(0, "utf8");
        if (!String(raw).trim()) {
            throw new Error(
                "pass the hex key: node bdeploy/cli.js --wrap-key <hex>"
            );
        }
    } else {
        throw new Error(
            "pass the hex key: node bdeploy/cli.js --wrap-key <hex>"
        );
    }
    if (isWrapped(raw)) {
        throw new Error("value is already wrapped; nothing to do");
    }
    const wrapped = wrap(raw);
    const written = upsertEnvPrivateKey(wrapped);
    if (unwrap(wrapped) !== normalizeKey(raw)) {
        throw new Error("wrap round-trip failed");
    }
    console.log(`wrote wrapped PRIVATE_KEY to ${written}`);
    return true;
}

module.exports = {
    PREFIX,
    ENV_PATH,
    wrap,
    unwrap,
    isWrapped,
    resolveSignerKey,
    wrapKeyFromArgv,
    normalizeKey,
};
