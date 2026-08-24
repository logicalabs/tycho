const {loadEthers} = require("./deps");
const {isEmptyCode} = require("./compare");
const {feeOverrides} = require("./gas");

const TIMESTAMP_ABI = [
    "function executorsActivationTimestamp(address) view returns (uint256)",
];
const SET_ABI = [
    "function setExecutors(address[] targets)",
];

function uniqueChecksummed(executorAddrs) {
    const ethers = loadEthers();
    return [
        ...new Set(executorAddrs.map((a) => ethers.utils.getAddress(a))),
    ];
}

async function missingExecutors(provider, routerAddr, executorAddrs) {
    if (isEmptyCode(await provider.getCode(routerAddr))) {
        throw new Error(`router ${routerAddr} has no code`);
    }
    const ethers = loadEthers();
    const router = new ethers.Contract(routerAddr, TIMESTAMP_ABI, provider);
    const unique = uniqueChecksummed(executorAddrs);
    const missing = [];
    for (const addr of unique) {
        const ts = await router.executorsActivationTimestamp(addr);
        if (ts.eq(0)) {
            missing.push(addr);
        }
    }
    return missing;
}

async function setExecutors({wallet, routerAddr, executorAddrs, dryRun}) {
    if (isEmptyCode(await wallet.provider.getCode(routerAddr))) {
        if (dryRun) {
            return {
                sent: false,
                addresses: uniqueChecksummed(executorAddrs),
                dryRun: true,
                routerMissing: true,
            };
        }
        throw new Error(`router ${routerAddr} has no code`);
    }
    const missing = await missingExecutors(
        wallet.provider,
        routerAddr,
        executorAddrs
    );
    if (missing.length === 0) {
        return {sent: false, addresses: []};
    }
    if (dryRun) {
        return {sent: false, addresses: missing, dryRun: true};
    }
    const ethers = loadEthers();
    const router = new ethers.Contract(routerAddr, SET_ABI, wallet);
    const fees = await feeOverrides(wallet.provider);
    const tx = await router.setExecutors(missing, {
        ...fees,
        gasLimit: 3_000_000,
    });
    const receipt = await wallet.provider.waitForTransaction(
        tx.hash,
        1,
        180_000
    );
    if (!receipt) {
        throw new Error(`timeout waiting for setExecutors ${tx.hash}`);
    }
    if (receipt.status === 0) {
        throw new Error(`setExecutors reverted: ${tx.hash}`);
    }
    return {sent: true, addresses: missing, txHash: tx.hash};
}

module.exports = {missingExecutors, setExecutors};
