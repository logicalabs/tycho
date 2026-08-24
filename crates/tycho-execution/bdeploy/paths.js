const path = require("path");

const BDEPLOY = __dirname;
const EXECUTION = path.join(BDEPLOY, "..");
const CONTRACTS = path.join(EXECUTION, "contracts");
const CONFIG = path.join(EXECUTION, "config");
const OVERLAY = path.join(BDEPLOY, ".overlay");
const OUT_DIR = path.join(BDEPLOY, "out");
const STATE_PATH = path.join(BDEPLOY, "state.json");

const CREATE2_FACTORY = "0x4e59b44847b379578588920cA78FbF26c0B4956C";
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
const RPC = (chainId) => `http://localhost:2424/${chainId}`;

module.exports = {
    BDEPLOY,
    EXECUTION,
    CONTRACTS,
    CONFIG,
    OVERLAY,
    OUT_DIR,
    STATE_PATH,
    CREATE2_FACTORY,
    PERMIT2,
    RPC,
};
