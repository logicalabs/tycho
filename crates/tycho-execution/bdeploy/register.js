const {loadEthers} = require("./deps");
const {isEmptyCode} = require("./compare");

const TIMESTAMP_ABI = [
    "function executorsActivationTimestamp(address) view returns (uint256)",
];
const SET_ABI = [
    "function setExecutors(address[] targets)",
];

async function missingExecutors(provider, routerAddr, executorAddrs) {
    if (isEmptyCode(await provider.getCode(routerAddr))) {
        throw new Error(`router ${routerAddr} has no code`);
    }
    const ethers = loadEthers();
    const router = new ethers.Contract(routerAddr, TIMESTAMP_ABI, provider);
    const unique = [...new Set(executorAddrs.map((a) => a.toLowerCase()))];
    const missing = [];
    for (const addr of unique) {
        const ts = await router.executorsActivationTimestamp(addr);
        if (ts.eq(0)) {
            missing.push(ethers.utils.getAddress(addr));
        }
    }
    return missing;
}

async function setExecutors({wallet, routerAddr, executorAddrs, dryRun}) {
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
    const tx = await router.setExecutors(missing);
    await tx.wait();
    return {sent: true, addresses: missing, txHash: tx.hash};
}

module.exports = {missingExecutors, setExecutors};
