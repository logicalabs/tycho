#!/usr/bin/env node
const {loadDotenv, loadEthers} = require("./deps");
loadDotenv();

const {RPC, PERMIT2} = require("./paths");
const {resolveChains, isDryRun} = require("./chains");
const {buildInventory} = require("./inventory");
const {prepareOverlay, compileOverlay, loadArtifact} = require("./overlay");
const {decide, saltFor, isEmptyCode, codeHash} = require("./compare");
const {assertCreate2Factory, getInitcode, create2Deploy} = require("./deploy");
const {setExecutors} = require("./register");
const {writeMapping} = require("./mapping");
const {loadState, saveState, networkState} = require("./state");

function parseHelp(argv) {
    return argv.includes("--help") || argv.includes("-h");
}

function printHelp() {
    console.log(`bdeploy — differential custom deployer for tycho-execution

Usage:
  node bdeploy/cli.js --chains 1,8453,130
  node bdeploy/cli.js --chains 1 --dry-run
  node bdeploy/cli.js              # all official Hardhat chain IDs

RPC:            http://localhost:2424/<chainid>
Signer:         PRIVATE_KEY env
Overlay:        DELAY_EXECUTOR_ACTIVATION=0, bool private constant bdeploy=true
`);
}

function log(network, chainId, msg) {
    console.log(`[${network} / ${chainId}] ${msg}`);
}

async function ensureContract({
    wallet,
    artifact,
    contractName,
    args,
    recordedAddr,
    dryRun,
    label,
}) {
    const initcode = getInitcode(artifact, args);
    const salt = saltFor(contractName, args);
    const decision = await decide({
        provider: wallet.provider,
        initcode,
        salt,
        recordedAddr,
    });
    if (decision.action === "keep") {
        return {
            address: decision.address,
            runtimeCodeHash: decision.runtimeCodeHash,
            deployed: false,
            label,
        };
    }
    const deployed = await create2Deploy({
        wallet,
        initcode,
        salt,
        dryRun,
    });
    const runtimeCodeHash = dryRun
        ? null
        : deployed.runtimeCodeHash ||
          codeHash(await wallet.provider.getCode(deployed.address));
    return {
        address: deployed.address,
        runtimeCodeHash,
        deployed: !dryRun,
        label,
    };
}

async function runChain({chain, wallet, artifacts, state, dryRun}) {
    const {chainId, name} = chain;
    const ns = networkState(state, name);
    const inventory = buildInventory(name);
    const summary = {txs: 0, deployed: [], kept: [], setExecutors: []};

    await assertCreate2Factory(wallet.provider, chainId);

    const signerAddr = await wallet.getAddress();

    const feeResult = await ensureContract({
        wallet,
        artifact: artifacts.FeeCalculator,
        contractName: "FeeCalculator",
        args: [signerAddr],
        recordedAddr: ns.feeCalculator && ns.feeCalculator.bdeployAddress,
        dryRun,
        label: "FeeCalculator",
    });
    log(
        name,
        chainId,
        `FeeCalculator: ${feeResult.deployed ? "deploy" : "keep"} ${feeResult.address}`
    );
    if (feeResult.deployed) {
        summary.txs++;
        summary.deployed.push("FeeCalculator");
    } else {
        summary.kept.push("FeeCalculator");
    }
    ns.feeCalculator = {
        bdeployAddress: feeResult.address,
        runtimeCodeHash: feeResult.runtimeCodeHash,
    };

    const executorResults = [];
    for (const group of inventory.executors) {
        const result = await ensureContract({
            wallet,
            artifact: artifacts[group.contract],
            contractName: group.contract,
            args: group.args,
            recordedAddr:
                group.officialAddress &&
                ns.executors[group.officialAddress] &&
                ns.executors[group.officialAddress].bdeployAddress,
            dryRun,
            label: group.labels.join(", "),
        });
        log(
            name,
            chainId,
            `${group.contract} (${group.labels.join(", ")}): ${
                result.deployed ? "deploy" : "keep"
            } ${result.address}`
        );
        if (result.deployed) {
            summary.txs++;
            summary.deployed.push(group.contract);
        } else {
            summary.kept.push(group.contract);
        }
        const resolved = {
            ...group,
            bdeployAddress: result.address,
            runtimeCodeHash: result.runtimeCodeHash,
        };
        executorResults.push(resolved);
        if (group.officialAddress) {
            ns.executors[group.officialAddress] = {
                labels: group.labels,
                contract: group.contract,
                args: group.args,
                bdeployAddress: result.address,
                runtimeCodeHash: result.runtimeCodeHash,
            };
        }
    }

    const routerResult = await ensureContract({
        wallet,
        artifact: artifacts.TychoRouterV3,
        contractName: "TychoRouterV3",
        args: [
            PERMIT2,
            feeResult.address,
            signerAddr,
            signerAddr,
            signerAddr,
            signerAddr,
        ],
        recordedAddr: ns.router && ns.router.bdeployAddress,
        dryRun,
        label: "TychoRouterV3",
    });
    log(
        name,
        chainId,
        `TychoRouterV3: ${routerResult.deployed ? "deploy" : "keep"} ${
            routerResult.address
        }`
    );
    if (routerResult.deployed) {
        summary.txs++;
        summary.deployed.push("TychoRouterV3");
    } else {
        summary.kept.push("TychoRouterV3");
    }
    ns.router = {
        officialAddress: inventory.officialRouter,
        bdeployAddress: routerResult.address,
        runtimeCodeHash: routerResult.runtimeCodeHash,
    };

    const executorAddrs = executorResults.map((e) => e.bdeployAddress);
    try {
        const reg = await setExecutors({
            wallet,
            routerAddr: routerResult.address,
            executorAddrs,
            dryRun,
        });
        if (reg.dryRun) {
            log(
                name,
                chainId,
                reg.addresses.length > 0
                    ? `setExecutors: would register ${reg.addresses.length}`
                    : "setExecutors: all executors already registered"
            );
        } else if (reg.sent) {
            summary.txs++;
            summary.setExecutors = reg.addresses;
            log(
                name,
                chainId,
                `setExecutors: registered ${reg.addresses.length} (${reg.txHash})`
            );
        } else {
            log(name, chainId, "setExecutors: all executors already registered");
        }
    } catch (err) {
        if (dryRun) {
            log(
                name,
                chainId,
                `setExecutors: skipped (${err.message})`
            );
        } else {
            throw err;
        }
    }

    if (summary.txs === 0) {
        log(name, chainId, "up to date — no transactions sent");
    } else {
        log(
            name,
            chainId,
            `catch-up complete — ${summary.txs} tx(s), deployed: ${
                summary.deployed.join(", ") || "(none)"
            }`
        );
    }

    return {inventory, executorResults, router: routerResult, summary};
}

async function main() {
    const argv = process.argv.slice(2);
    if (parseHelp(argv)) {
        printHelp();
        return;
    }

    const dryRun = isDryRun(argv);
    const chains = resolveChains(argv);
    const ethers = loadEthers();

    if (!dryRun && !process.env.PRIVATE_KEY) {
        throw new Error("PRIVATE_KEY is required (or pass --dry-run)");
    }

    console.log(
        `bdeploy: overlay compile, then ${chains
            .map((c) => `${c.name}=${c.chainId}`)
            .join(", ")}${dryRun ? " (dry-run)" : ""}`
    );

    prepareOverlay();
    compileOverlay();

    const artifacts = {
        FeeCalculator: loadArtifact("FeeCalculator"),
        TychoRouterV3: loadArtifact("TychoRouterV3"),
    };

    const state = loadState();
    const seenContracts = new Set();
    for (const chain of chains) {
        const inventory = buildInventory(chain.name);
        for (const group of inventory.executors) {
            if (!seenContracts.has(group.contract)) {
                artifacts[group.contract] = loadArtifact(group.contract);
                seenContracts.add(group.contract);
            }
        }
    }

    const dummyKey =
        "0x0000000000000000000000000000000000000000000000000000000000000001";
    const results = await Promise.all(
        chains.map(async (chain) => {
            const provider = new ethers.providers.StaticJsonRpcProvider(
                RPC(chain.chainId),
                chain.chainId
            );
            const net = await provider.getNetwork();
            if (Number(net.chainId) !== chain.chainId) {
                throw new Error(
                    `RPC ${RPC(chain.chainId)} reported chainId ${net.chainId}`
                );
            }
            const wallet = new ethers.Wallet(
                process.env.PRIVATE_KEY || dummyKey,
                provider
            );
            try {
                const result = await runChain({
                    chain,
                    wallet,
                    artifacts,
                    state,
                    dryRun,
                });
                return {chain, ok: true, result};
            } catch (err) {
                console.error(
                    `[${chain.name} / ${chain.chainId}] FAILED: ${err.message || err}`
                );
                return {chain, ok: false, error: err};
            }
        })
    );

    const routers = {};
    const executorsByChain = {};
    let anyTx = false;
    let failures = 0;
    for (const item of results) {
        if (!item.ok) {
            failures++;
            continue;
        }
        routers[item.chain.name] = item.result.router.address;
        executorsByChain[item.chain.name] = item.result.executorResults;
        if (item.result.summary.txs > 0) {
            anyTx = true;
        }
    }

    if (!dryRun && failures < results.length) {
        saveState(state);
    }

    const files = writeMapping({routers, executorsByChain});
    console.log(`mapping: ${files.stamped}`);
    console.log(`mapping: ${files.latestRoot}`);

    if (failures === 0 && !anyTx) {
        console.log("All chains up to date. No transactions sent.");
    } else if (failures === 0) {
        console.log("Differential deploy complete.");
    }

    if (failures > 0) {
        process.exitCode = 1;
    }
}

if (require.main === module) {
    main().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}

module.exports = {main};
