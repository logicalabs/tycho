# bdeploy — plan, milestones, and handoff

**Status:** implementation written, **not verified**. Last commit: `223fce4c6 WIP - custom deployer`.

**Stop reason:** `npm install` in `crates/tycho-execution/contracts/` was interrupted so work can continue as a non-root user. `contracts/node_modules` was missing (no `ethers`). Overlay `forge build` never ran. No dry-run or live RPC test.

Next session: pick up at **Milestone 4**.

---

## Goal

Private parallel deployment of every tycho-execution contract, easy to refresh after upstream merges.

Differential deployer:

| On-chain state | Behavior |
|---|---|
| Nothing deployed | Deploy full custom suite + `setExecutors` |
| Everything current | Confirm, print “up to date”, **no txs** |
| Partial / drifted / new upstream contracts | Only the txs needed to catch up, including `setExecutors` for unregistered executors |

Always emit a timestamped official-addr → `bdeployAddress` mapping, even if nothing deployed.

---

## Locked decisions (do not reopen unless asked)

1. **Additive only.** Code lives in `crates/tycho-execution/bdeploy/`. Do not edit official `.sol` or `scripts/deploy-*.js`. `contracts/package.json` has one additive script: `"bdeploy": "node ../bdeploy/cli.js"`.
2. **Overlay compile, not bytecode surgery.** Temp copy of `contracts/src`; patch DELAY; inject constant; compile; deploy from artifacts. Repo `.sol` files stay untouched.
3. **`bool private constant bdeploy = true`** (not a storage `bool`). Storage bool would shift TychoRouterV3 slots. Constant inlines and makes bytecode distinct.
4. **`DELAY_EXECUTOR_ACTIVATION = 0 days`** via overlay replace of the `3 days` constant in `Dispatcher.sol`.
5. **UniswapXFiller skipped** (v1).
6. **Chains are dynamic.** Caller passes `--chains 1,8453,130`. RPC is always `http://localhost:2424/<chainid>`. Name lookup from official `contracts/hardhat.config.js` (skip `tenderly_*`). Omit `--chains` → all official Hardhat chain IDs.
7. **Inventory from official configs**, not a parallel list:
   - `deploy_protocols` parsed out of `contracts/scripts/deploy-executors.js` (cannot `require()` it — it loads Hardhat)
   - `config/executor_deployments.json` — contract + ctor args
   - `config/executor_addresses.json` — official addr + extra labels sharing that addr (`sushiswap_v2`, `pancakeswap_v3`, `quickswap_v2`, `ramses_v3`)
   - `config/router_addresses.json`
   - Plus FeeCalculator + TychoRouterV3 every chain
8. **Dedupe by official address.** One UniswapV3Executor deploy serves `uniswap_v3` + `pancakeswap_v3`.
9. **CREATE2** factory `0x4e59b44847b379578588920cA78FbF26c0B4956C`. Salt `id("bdeploy:<contract>:<json args>")` — **no network name**, so identical initcode lands at the same address on every chain (matches the user’s sample mapping).
10. **Redeploy signal:** `eth_getCode` at predicted CREATE2 address, else recorded `bdeployAddress` vs compiled runtime (`eth_call` of initcode when constructor allows).
11. **`setExecutors`:** query `executorsActivationTimestamp`; only pass addrs with timestamp 0. Covers “deployed last run, register failed”.
12. **Roles = signer** (`PRIVATE_KEY`). Do not use official `scripts/roles.json` (Tycho’s Safe). Direct EOA, no Safe.
13. **Outputs:** `state.json` (machine), `out/<timestamp>.mapping.js` + `latest.mapping.js` + `bdeploy/latest.mapping.js`. `CUSTOM_TYCHO_ROUTER` is a **per-chain object**. FeeCalculator in state only. No explorer/Tenderly verify.
14. **Official encoder JSON untouched.** Mapping file is the consumer deliverable.
15. **Compiler:** Foundry overlay (not Hardhat), `solc 0.8.33`, `cancun`, `via_ir`, `optimizer_runs = 1000`. Official Foundry default is `osaka` / 200 runs / `bytecode_hash = none` — do not mix. Overlay deletes `src/uniswap_x` so filler is not compiled.

Chat that produced this: architecture confirmed, then assumptions. Assumption #3 was corrected to dynamic chain IDs. All other original assumptions kept.

---

## Layout

```
crates/tycho-execution/bdeploy/
  cli.js          orchestrator
  paths.js        roots, CREATE2, Permit2, RPC helper
  deps.js         load ethers/dotenv from contracts/node_modules
  chains.js       parse hardhat.config.js; --chains
  inventory.js    official configs → per-chain deploy plan
  overlay.js      tmp Foundry project + DELAY patch + constant inject
  compare.js      salt, CREATE2 predict, keep vs deploy
  deploy.js       CREATE2 send
  register.js     executorsActivationTimestamp + setExecutors
  mapping.js      JS artifact emitter
  state.js        state.json load/save
  state.json      {}  (empty; first live run fills it)
  .gitignore      .overlay/, out/, caches
  latest.mapping.js   written at runtime (not in git)

.claude/plans/custom-execution-deployments.md   this file
```

Entry: `node crates/tycho-execution/bdeploy/cli.js --chains 1,8453,130`

From contracts dir: `npm run bdeploy -- --chains 1 --dry-run`

Needs: `PRIVATE_KEY` (unless `--dry-run`), `forge` on PATH, `contracts/node_modules` (`ethers`, `dotenv`), RPC multiplexer at `localhost:2424/<chainid>`.

Per-chain order: FeeCalculator → executors → TychoRouterV3 (ctor needs calculator code) → `setExecutors`. Chains in `Promise.all`.

Cascade: FeeCalculator bytecode change → new calculator → new router (addr is ctor arg) → full `setExecutors`.

---

## Milestones

### 1. Plan — done

Architecture: overlay orchestrator, not a fork of official deploy scripts. Stored above.

### 2. Scaffold modules — done (committed)

All JS files listed above exist and are wired. `cli.js` is the full flow, not stubs.

### 3. Overlay + inventory logic — done, **untested**

Written:

- Copy `contracts/src` → `bdeploy/.overlay/src`, symlink `lib` + `interfaces`, copy `remappings.txt`
- Replace `DELAY_EXECUTOR_ACTIVATION = 3 days` → `0 days` (throws if upstream string drifted)
- Inject `bool private constant bdeploy = true` into `FeeCalculator.sol`, `TychoRouterV3.sol`, every `src/executors/*.sol`
- `forge build` in overlay
- Parse `deploy_protocols` via `Function()` on the object literal in `deploy-executors.js`
- Group extra labels onto shared official addresses

Never executed end-to-end.

### 4. Local deps + unit checks — **next (blocked on non-root + npm)**

Interrupted here.

1. As the restricted user, from `crates/tycho-execution/contracts/`: `npm install` (repo uses npm/`package-lock.json` here, not pnpm).
2. Confirm `contracts/node_modules/ethers` exists.
3. Run the sanity snippet below (inventory, chains, inject, mapping). The first chains parser (`[\s\S]*?` to first `},`) **failed**; current `chains.js` uses brace matching — confirm it returns 8 chains.

```bash
node -e "
const {loadOfficialChainMap, resolveChains} = require('./crates/tycho-execution/bdeploy/chains');
console.log(loadOfficialChainMap());
console.log(resolveChains(['--chains','1,8453']));
const {buildInventory} = require('./crates/tycho-execution/bdeploy/inventory');
const inv = buildInventory('ethereum');
console.log(inv.executors.find(e => e.labels.includes('uniswap_v2')));
console.log(inv.executors.find(e => e.labels.includes('uniswap_v3')));
"
```

Expect: `uniswap_v2` group also has `sushiswap_v2`; `uniswap_v3` also has `pancakeswap_v3`.

4. `prepareOverlay()` only (no forge): grep overlay `Dispatcher.sol` for `0 days` and an executor for `bool private constant bdeploy`.

### 5. Overlay compile — not started

`forge build` in `.overlay/` with viaIR + 1000 runs. TychoRouterV3 compile can take several minutes. Fix remappings/symlinks if forge errors. Then `loadArtifact('UniswapV2Executor')` etc.

### 6. Dry-run against RPC — not started

```bash
export PRIVATE_KEY=...   # optional for dry-run
node crates/tycho-execution/bdeploy/cli.js --chains 1 --dry-run
```

Confirms: RPC chainId match, CREATE2 factory present, keep vs would-deploy, mapping file written, `state.json` **not** updated on dry-run.

### 7. Live catch-up deploy — not started

One chain first (`--chains 1`), then a batch. Confirm:

- First run deploys everything + `setExecutors`
- Second run: “All chains up to date. No transactions sent.”
- Mapping format matches user sample (array if multiple labels, object if one; checksummed official keys)

---

## Known issues / traps for the next AI

- **`npm install` was killed.** Do not assume `node_modules` exists. `deps.js` loads ethers from `crates/tycho-execution/contracts/node_modules`.
- **`chains.js` parser:** first version captured only the first network block. Current version: `extractObjectBlock` + per-entry `chainId`. Verify before trusting `--chains` omitted (all networks).
- **Do not `require()` `deploy-executors.js`.** It `require("hardhat")`. Inventory parses the source text.
- **TychoRouter constructor** reverts if `feeCalculator.code.length == 0`. Always deploy/keep FeeCalculator first. `eth_call` of router initcode for runtime compare will revert if the calculator is not on-chain yet — `compare.js` already catches that and falls back to CREATE2 predict.
- **CREATE2 `msg.sender`** is the factory, not the wallet. FeeCalculator sets `_routerFeeReceiver = msg.sender` (same as official CREATE2 deploys). Roles still go to the signer via ctor args.
- **Permit2** hardcoded `0x000000000022D473030F116dDEE9F6B43aC78BA3` — must exist on the target chain (official deploys assume it).
- **Arachnid CREATE2 factory** must already be at `0x4e59…`. If missing, that chain fails.
- **`setExecutors` is `whenNotPaused`.** New router starts unpaused.
- **`ExecutorAlreadyExists`** if you re-pass an active executor — register path filters via timestamp.
- Overlay DELAY patch is an exact string match on `= 3 days;`. If upstream changes that line, `overlay.js` throws on purpose.
- `bdeploy/.overlay/` and `bdeploy/out/` are gitignored.
- No Solidity tests were added; this is a Node orchestrator.

---

## Mapping shape (required output)

```js
const CUSTOM_TYCHO_ROUTER = {
  "ethereum": "0x...",
  "base": "0x..."
};

const CUSTOM_EXECUTOR_MAPPING = {
  "ethereum": {
    "0xOfficialShared": [
      { "label": "uniswap_v3", "bdeployAddress": "0xCustom" },
      { "label": "pancakeswap_v3", "bdeployAddress": "0xCustom" }
    ],
    "0xOfficialSingle": {
      "label": "uniswap_v4",
      "bdeployAddress": "0xCustom"
    }
  }
};
```

User’s original sample used a single `CUSTOM_TYCHO_ROUTER` string. Locked as per-chain object because FeeCalculator addr is a router ctor arg (addresses may still coincide across chains when initcode matches).

Include `native_wrapper` and every official label. Do not put FeeCalculator in the pretty mapping.

---

## Knowledge / docs already read

- `.claude/skills/plan/SKILL.md`
- `.claude/knowledge/solidity.md`
- `.claude/CODEBASE.md`
- `crates/tycho-execution/CLAUDE.md`
- Official deploy scripts, `Dispatcher.sol`, `hardhat.config.js`, `foundry.toml`, `executor_addresses.json`, `executor_deployments.json`, `router_addresses.json`, `roles.json`

Do not use the Explore agent as a first step; these docs plus `bdeploy/*.js` are the source of truth.
