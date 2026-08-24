const fs = require("fs");
const {STATE_PATH} = require("./paths");

function loadState() {
    if (!fs.existsSync(STATE_PATH)) {
        return {};
    }
    return JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
}

function saveState(state) {
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + "\n");
}

function networkState(state, network) {
    if (!state[network]) {
        state[network] = {feeCalculator: null, router: null, executors: {}};
    }
    if (!state[network].executors) {
        state[network].executors = {};
    }
    return state[network];
}

module.exports = {loadState, saveState, networkState};
