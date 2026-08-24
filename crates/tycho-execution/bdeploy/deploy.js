const {CREATE2_FACTORY} = require("./paths");
const {loadEthers} = require("./deps");
const {isEmptyCode, codeHash} = require("./compare");

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

    const txReq = {
        to: CREATE2_FACTORY,
        data: ethers.utils.concat([salt, initcode]),
    };
    try {
        const gas = await wallet.estimateGas(txReq);
        txReq.gasLimit = gas.mul(130).div(100);
    } catch (_) {
        txReq.gasLimit = 8_000_000;
    }

    const tx = await wallet.sendTransaction(txReq);
    await tx.wait();

    const code = await wallet.provider.getCode(predicted);
    if (isEmptyCode(code)) {
        throw new Error(`CREATE2 reported success but ${predicted} has no code`);
    }
    return {address: predicted, txHash: tx.hash, runtimeCodeHash: codeHash(code)};
}

module.exports = {assertCreate2Factory, getInitcode, create2Deploy};
