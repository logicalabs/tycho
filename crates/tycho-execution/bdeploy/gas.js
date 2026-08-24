const {loadEthers} = require("./deps");

const BOOST_NUM = 115;
const BOOST_DEN = 100;

function boost(bn) {
    return bn.mul(BOOST_NUM).div(BOOST_DEN);
}

function formatGwei(bn) {
    const ethers = loadEthers();
    return ethers.utils.formatUnits(bn, "gwei");
}

function describeFees(fees) {
    if (fees.maxFeePerGas) {
        return (
            `maxFee=${formatGwei(fees.maxFeePerGas)} gwei ` +
            `priority=${formatGwei(fees.maxPriorityFeePerGas)} gwei ` +
            `(rpc +15%)`
        );
    }
    return `gasPrice=${formatGwei(fees.gasPrice)} gwei (rpc +15%)`;
}

async function feeOverrides(provider) {
    const ethers = loadEthers();
    const [gasPrice, block] = await Promise.all([
        provider.getGasPrice(),
        provider.getBlock("latest"),
    ]);
    if (!gasPrice || gasPrice.isZero()) {
        throw new Error("eth_gasPrice returned 0");
    }

    if (block && block.baseFeePerGas) {
        let tip;
        try {
            tip = ethers.BigNumber.from(
                await provider.send("eth_maxPriorityFeePerGas", [])
            );
        } catch (_) {
            tip = gasPrice.gt(block.baseFeePerGas)
                ? gasPrice.sub(block.baseFeePerGas)
                : ethers.BigNumber.from(0);
        }
        const impliedTip = gasPrice.gt(block.baseFeePerGas)
            ? gasPrice.sub(block.baseFeePerGas)
            : ethers.BigNumber.from(0);
        if (impliedTip.gt(0) && tip.gt(impliedTip)) {
            tip = impliedTip;
        }
        let maxPriorityFeePerGas = boost(tip);
        let maxFeePerGas = boost(gasPrice);
        const floor = block.baseFeePerGas.add(maxPriorityFeePerGas);
        if (maxFeePerGas.lt(floor)) {
            maxFeePerGas = floor;
        }
        if (maxPriorityFeePerGas.gt(maxFeePerGas)) {
            maxPriorityFeePerGas = maxFeePerGas;
        }
        return {
            type: 2,
            maxFeePerGas,
            maxPriorityFeePerGas,
        };
    }

    return {gasPrice: boost(gasPrice)};
}

module.exports = {BOOST_NUM, BOOST_DEN, feeOverrides, describeFees, formatGwei};
