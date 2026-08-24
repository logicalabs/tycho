const {CREATE2_FACTORY} = require("./paths");
const {loadEthers} = require("./deps");
const {isEmptyCode, codeHash, waitForCode} = require("./compare");
const {feeOverrides} = require("./gas");

async function assertCreate2Factory(provider, chainId) {
    const code = await provider.getCode(CREATE2_FACTORY);
    if (isEmptyCode(code)) {
        throw new Error(
            `CREATE2 factory ${CREATE2_FACTORY} missing on chain ${chainId}`
        );
    }
}

function getInitcode(artifact, args) {
    const ethers = loadEthers();
    const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode);
    const tx = factory.getDeployTransaction(...args);
    return tx.data;
}

async function create2Deploy({wallet, initcode, salt, dryRun}) {
    const ethers = loadEthers();
    const predicted = ethers.utils.getCreate2Address(
        CREATE2_FACTORY,
        salt,
        ethers.utils.keccak256(initcode)
    );
    if (dryRun) {
        return {address: predicted, txHash: null};
    }
    const fees = await feeOverrides(wallet.provider);
    const txReq = {
        to: CREATE2_FACTORY,
        data: ethers.utils.concat([salt, initcode]),
        // Skip eth_estimateGas: the RPC multiplexer fans out and can hang
        // indefinitely on large CREATE2 initcode.
        gasLimit: 8_000_000,
        ...fees,
    };

    const tx = await wallet.sendTransaction(txReq);
    const receipt = await wallet.provider.waitForTransaction(
        tx.hash,
        1,
        180_000
    );
    if (!receipt) {
        throw new Error(`timeout waiting for CREATE2 ${tx.hash}`);
    }
    if (receipt.status === 0) {
        throw new Error(`CREATE2 tx reverted: ${tx.hash}`);
    }

    const code = await waitForCode(wallet.provider, predicted);
    return {address: predicted, txHash: tx.hash, runtimeCodeHash: codeHash(code)};
}

module.exports = {assertCreate2Factory, getInitcode, create2Deploy};
