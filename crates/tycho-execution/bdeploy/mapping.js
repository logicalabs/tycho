const fs = require("fs");
const path = require("path");
const {OUT_DIR, BDEPLOY} = require("./paths");

function formatEntry(labels, bdeployAddress) {
    if (labels.length === 1) {
        return {label: labels[0], bdeployAddress};
    }
    return labels.map((label) => ({label, bdeployAddress}));
}

function buildMappingJs({routers, executorsByChain}) {
    const routersObj = {};
    for (const [chain, addr] of Object.entries(routers)) {
        routersObj[chain] = addr;
    }
    const mapping = {};
    for (const [chain, groups] of Object.entries(executorsByChain)) {
        mapping[chain] = {};
        for (const group of groups) {
            if (!group.officialAddress) {
                continue;
            }
            mapping[chain][group.officialAddress] = formatEntry(
                group.labels,
                group.bdeployAddress
            );
        }
    }
    return (
        `const CUSTOM_TYCHO_ROUTER = ${JSON.stringify(routersObj, null, 2)};\n\n` +
        `const CUSTOM_EXECUTOR_MAPPING = ${JSON.stringify(mapping, null, 2)};\n`
    );
}

function timestampName(date = new Date()) {
    return date.toISOString().replace(/[:.]/g, "-").replace("Z", "Z");
}

function writeMapping({routers, executorsByChain}) {
    fs.mkdirSync(OUT_DIR, {recursive: true});
    const body = buildMappingJs({routers, executorsByChain});
    const stamped = path.join(OUT_DIR, `${timestampName()}.mapping.js`);
    const latestOut = path.join(OUT_DIR, "latest.mapping.js");
    const latestRoot = path.join(BDEPLOY, "latest.mapping.js");
    fs.writeFileSync(stamped, body);
    fs.writeFileSync(latestOut, body);
    fs.writeFileSync(latestRoot, body);
    return {stamped, latestOut, latestRoot};
}

module.exports = {formatEntry, buildMappingJs, writeMapping, timestampName};
