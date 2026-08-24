const fs = require("fs");
const path = require("path");
const {CONTRACTS} = require("./paths");

const TENDERLY_PREFIX = "tenderly_";

function extractObjectBlock(src, key) {
    const keyIdx = src.search(new RegExp(`${key}\\s*:`));
    if (keyIdx < 0) {
        throw new Error(`could not find ${key} in hardhat.config.js`);
    }
    const brace = src.indexOf("{", keyIdx);
    let depth = 0;
    for (let i = brace; i < src.length; i++) {
        if (src[i] === "{") {
            depth++;
        } else if (src[i] === "}") {
            depth--;
            if (depth === 0) {
                return src.slice(brace + 1, i);
            }
        }
    }
    throw new Error(`unbalanced braces for ${key} in hardhat.config.js`);
}

function loadOfficialChainMap() {
    const src = fs.readFileSync(
        path.join(CONTRACTS, "hardhat.config.js"),
        "utf8"
    );
    const networksBlock = extractObjectBlock(src, "networks");
    const nameToChainId = {};
    const chainIdToName = {};
    const entryRe = /(\w+)\s*:\s*\{([^}]*)\}/g;
    let match;
    while ((match = entryRe.exec(networksBlock)) !== null) {
        const name = match[1];
        if (name.startsWith(TENDERLY_PREFIX)) {
            continue;
        }
        const chainIdMatch = match[2].match(/chainId:\s*(\d+)/);
        if (!chainIdMatch) {
            continue;
        }
        const chainId = Number(chainIdMatch[1]);
        nameToChainId[name] = chainId;
        chainIdToName[chainId] = name;
    }
    if (Object.keys(chainIdToName).length === 0) {
        throw new Error("no chainIds found in hardhat.config.js networks");
    }
    return {nameToChainId, chainIdToName};
}

function parseChainArgs(argv) {
    const ids = [];
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--chains" || arg === "--chain") {
            const value = argv[i + 1];
            if (!value || value.startsWith("--")) {
                throw new Error(`${arg} requires a value (e.g. 1,8453,130)`);
            }
            for (const part of value.split(",")) {
                const id = Number(part.trim());
                if (!Number.isInteger(id) || id <= 0) {
                    throw new Error(`invalid chain id: ${part}`);
                }
                ids.push(id);
            }
            i++;
        }
    }
    return [...new Set(ids)];
}

function resolveChains(argv) {
    const {nameToChainId, chainIdToName} = loadOfficialChainMap();
    const requested = parseChainArgs(argv);
    const chainIds =
        requested.length > 0 ? requested : Object.values(nameToChainId);
    return chainIds.map((chainId) => {
        const name = chainIdToName[chainId];
        if (!name) {
            const known = Object.entries(chainIdToName)
                .map(([id, n]) => `${n}=${id}`)
                .join(", ");
            throw new Error(
                `no official inventory for chainId ${chainId} (known: ${known})`
            );
        }
        return {chainId, name};
    });
}

function isDryRun(argv) {
    return argv.includes("--dry-run");
}

module.exports = {
    loadOfficialChainMap,
    parseChainArgs,
    resolveChains,
    isDryRun,
};
