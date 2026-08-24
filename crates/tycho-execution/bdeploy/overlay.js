const fs = require("fs");
const path = require("path");
const {spawnSync} = require("child_process");
const {CONTRACTS, OVERLAY} = require("./paths");

const DELAY_FROM = "uint256 public constant DELAY_EXECUTOR_ACTIVATION = 3 days;";
const DELAY_TO = "uint256 public constant DELAY_EXECUTOR_ACTIVATION = 0 days;";
const BDEPLOY_CONST = "    bool private constant bdeploy = true;";

const INJECT_FILES = [
    "FeeCalculator.sol",
    "TychoRouterV3.sol",
];

function injectConstant(source) {
    if (source.includes("bool private constant bdeploy")) {
        return source;
    }
    const next = source.replace(
        /^(contract \w[\s\S]*?\{)/m,
        `$1\n${BDEPLOY_CONST}`
    );
    if (next === source) {
        throw new Error("failed to inject bdeploy constant (no contract { found)");
    }
    return next;
}

function patchSources(overlaySrc) {
    const dispatcher = path.join(overlaySrc, "Dispatcher.sol");
    const dispatcherSrc = fs.readFileSync(dispatcher, "utf8");
    if (!dispatcherSrc.includes(DELAY_FROM)) {
        throw new Error(
            `DELAY_EXECUTOR_ACTIVATION pattern not found in Dispatcher.sol (upstream changed?)`
        );
    }
    fs.writeFileSync(dispatcher, dispatcherSrc.replace(DELAY_FROM, DELAY_TO));

    for (const file of INJECT_FILES) {
        const filePath = path.join(overlaySrc, file);
        fs.writeFileSync(filePath, injectConstant(fs.readFileSync(filePath, "utf8")));
    }

    const executorsDir = path.join(overlaySrc, "executors");
    for (const name of fs.readdirSync(executorsDir)) {
        if (!name.endsWith(".sol")) {
            continue;
        }
        const filePath = path.join(executorsDir, name);
        fs.writeFileSync(filePath, injectConstant(fs.readFileSync(filePath, "utf8")));
    }
}

function prepareOverlay() {
    fs.rmSync(OVERLAY, {recursive: true, force: true});
    fs.mkdirSync(OVERLAY, {recursive: true});

    const overlaySrc = path.join(OVERLAY, "src");
    fs.cpSync(path.join(CONTRACTS, "src"), overlaySrc, {recursive: true});
    fs.rmSync(path.join(overlaySrc, "uniswap_x"), {recursive: true, force: true});

    fs.symlinkSync(path.join(CONTRACTS, "lib"), path.join(OVERLAY, "lib"));
    fs.symlinkSync(
        path.join(CONTRACTS, "interfaces"),
        path.join(OVERLAY, "interfaces")
    );
    fs.copyFileSync(
        path.join(CONTRACTS, "remappings.txt"),
        path.join(OVERLAY, "remappings.txt")
    );

    fs.writeFileSync(
        path.join(OVERLAY, "foundry.toml"),
        [
            "[profile.default]",
            "src = 'src'",
            "out = 'out'",
            "libs = ['lib']",
            "solc = '0.8.33'",
            "evm_version = 'cancun'",
            "optimizer = true",
            "optimizer_runs = 1000",
            "via_ir = true",
            "",
        ].join("\n")
    );

    patchSources(overlaySrc);
    return OVERLAY;
}

function compileOverlay() {
    const result = spawnSync("forge", ["build"], {
        cwd: OVERLAY,
        stdio: "inherit",
        encoding: "utf8",
    });
    if (result.status !== 0) {
        throw new Error("forge build of overlay sources failed");
    }
}

function loadArtifact(contractName) {
    const outDir = path.join(OVERLAY, "out");
    const solFile = `${contractName}.sol`;
    const artifactPath = path.join(outDir, solFile, `${contractName}.json`);
    if (!fs.existsSync(artifactPath)) {
        throw new Error(`overlay artifact missing: ${artifactPath}`);
    }
    const json = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
    const bytecode = json.bytecode.object || json.bytecode;
    if (!bytecode || bytecode === "0x") {
        throw new Error(`empty bytecode for ${contractName}`);
    }
    return {abi: json.abi, bytecode};
}

module.exports = {
    DELAY_FROM,
    DELAY_TO,
    injectConstant,
    patchSources,
    prepareOverlay,
    compileOverlay,
    loadArtifact,
};
