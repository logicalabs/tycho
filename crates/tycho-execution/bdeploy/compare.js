const {CREATE2_FACTORY} = require("./paths");
const {loadEthers} = require("./deps");

function isEmptyCode(code) {
    return !code || code === "0x" || code === "0x0";
}

function saltFor(contractName, args) {
    const ethers = loadEthers();
    const normalized = args.map((arg) => {
        if (typeof arg === "string" && arg.startsWith("0x") && arg.length === 42) {
            return ethers.utils.getAddress(arg);
        }
        return arg;
    });
    return ethers.utils.id(`bdeploy:${contractName}:${JSON.stringify(normalized)}`);
}

function predictedAddress(initcode, salt) {
    const ethers = loadEthers();
    return ethers.utils.getCreate2Address(
        CREATE2_FACTORY,
        salt,
        ethers.utils.keccak256(initcode)
    );
}

function codeHash(code) {
    const ethers = loadEthers();
    return ethers.utils.keccak256(code);
}

async function decide({provider, initcode, salt, recordedAddr}) {
    const predicted = predictedAddress(initcode, salt);
    const atPredicted = await provider.getCode(predicted);
    if (!isEmptyCode(atPredicted)) {
        return {
            action: "keep",
            address: predicted,
            runtimeCodeHash: codeHash(atPredicted),
        };
    }

    if (recordedAddr) {
        const atRecorded = await provider.getCode(recordedAddr);
        if (!isEmptyCode(atRecorded)) {
            try {
                const expected = await provider.call({data: initcode});
                if (
                    !isEmptyCode(expected) &&
                    expected.toLowerCase() === atRecorded.toLowerCase()
                ) {
                    return {
                        action: "keep",
                        address: recordedAddr,
                        runtimeCodeHash: codeHash(atRecorded),
                    };
                }
            } catch (_) {
                // constructor may revert (e.g. router before fee calculator exists)
            }
        }
    }

    return {action: "deploy", address: predicted};
}

module.exports = {
    isEmptyCode,
    saltFor,
    predictedAddress,
    codeHash,
    decide,
};
