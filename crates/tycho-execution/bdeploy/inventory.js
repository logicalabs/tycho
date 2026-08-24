const fs = require("fs");
const path = require("path");
const {CONFIG, CONTRACTS} = require("./paths");
const {loadEthers} = require("./deps");

function checksum(addr) {
    const ethers = loadEthers();
    return ethers.utils.getAddress(addr);
}

function loadDeployProtocols() {
    const src = fs.readFileSync(
        path.join(CONTRACTS, "scripts/deploy-executors.js"),
        "utf8"
    );
    const start = src.indexOf("const deploy_protocols = ");
    if (start < 0) {
        throw new Error("deploy_protocols not found in deploy-executors.js");
    }
    const objStart = src.indexOf("{", start);
    const endMarker = src.indexOf("async function main", objStart);
    if (objStart < 0 || endMarker < 0) {
        throw new Error("failed to bound deploy_protocols object");
    }
    const slice = src.slice(objStart, endMarker).trim().replace(/;+$/, "");
    return Function(`"use strict"; return (${slice});`)();
}

function buildInventory(network) {
    const deployProtocols = loadDeployProtocols();
    const deployments = JSON.parse(
        fs.readFileSync(
            path.join(CONFIG, "executor_deployments.json"),
            "utf8"
        )
    );
    const officialAddresses = JSON.parse(
        fs.readFileSync(path.join(CONFIG, "executor_addresses.json"), "utf8")
    );
    const routerAddresses = JSON.parse(
        fs.readFileSync(path.join(CONFIG, "router_addresses.json"), "utf8")
    );

    const protocols = deployProtocols[network];
    if (!protocols) {
        throw new Error(`no deploy_protocols for network ${network}`);
    }
    const networkDeployments = deployments[network];
    if (!networkDeployments) {
        throw new Error(
            `no executor_deployments.json entry for network ${network}`
        );
    }
    const networkOfficial = officialAddresses[network] || {};

    const groupsByOfficial = new Map();
    const unofficial = [];

    for (const protocol of protocols) {
        const deployment = networkDeployments[protocol];
        if (!deployment) {
            throw new Error(
                `no executor_deployments.json config for ${protocol} on ${network}`
            );
        }
        const official = networkOfficial[protocol];
        const entry = {
            labels: [protocol],
            contract: deployment.contract,
            args: deployment.args || [],
            officialAddress: official ? checksum(official) : null,
        };
        if (!entry.officialAddress) {
            unofficial.push(entry);
            continue;
        }
        const key = entry.officialAddress.toLowerCase();
        const existing = groupsByOfficial.get(key);
        if (existing) {
            if (!existing.labels.includes(protocol)) {
                existing.labels.push(protocol);
            }
            continue;
        }
        groupsByOfficial.set(key, entry);
    }

    for (const [label, addr] of Object.entries(networkOfficial)) {
        const key = checksum(addr).toLowerCase();
        const group = groupsByOfficial.get(key);
        if (group && !group.labels.includes(label)) {
            group.labels.push(label);
        }
    }

    return {
        network,
        officialRouter: routerAddresses[network]
            ? checksum(routerAddresses[network])
            : null,
        executors: [...groupsByOfficial.values(), ...unofficial],
    };
}

module.exports = {loadDeployProtocols, buildInventory, checksum};
