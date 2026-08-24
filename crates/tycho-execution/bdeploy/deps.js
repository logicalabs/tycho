const path = require("path");
const {CONTRACTS} = require("./paths");

const NODE_MODULES = path.join(CONTRACTS, "node_modules");
if (!module.paths.includes(NODE_MODULES)) {
    module.paths.unshift(NODE_MODULES);
}

function loadEthers() {
    if (!module.paths.includes(NODE_MODULES)) {
        module.paths.unshift(NODE_MODULES);
    }
    return require(path.join(NODE_MODULES, "ethers"));
}

function loadDotenv() {
    try {
        require(path.join(NODE_MODULES, "dotenv")).config({
            path: path.join(CONTRACTS, ".env"),
        });
    } catch (_) {
        // optional
    }
}

module.exports = {loadEthers, loadDotenv, NODE_MODULES};
