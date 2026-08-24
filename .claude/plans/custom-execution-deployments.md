# bdeploy — plan, milestones, and handoff

**Status:** milestones 1–6 done. **Milestone 7 blocked on `PRIVATE_KEY`.**

Last implementation commit: `223fce4c6 WIP - custom deployer` (plus `dd4f25cca WIP status` on this checkout). Uncommitted this session: dry-run reporting fix, `setExecutors` dry-run when router missing, forge PATH fallback, `latest.mapping.js` gitignore.

**Stop reason:** quarantined user `quartycho` has no `PRIVATE_KEY` / `.env`. RPC multiplexer is live (`localhost:2424/1` chainId 1, `/8453` chainId 8453). CREATE2 factory and Permit2 both present on chain 1. First ethereum live run would send **25 txs** (24 CREATE2 + `setExecutors`).

Next session: pick up at **Milestone 7**. Need `export PRIVATE_KEY=...` (or `crates/tycho-execution/contracts/.env`). Then:

```bash
export PATH="$HOME/.foundry/bin:$PATH"
node crates/tycho-execution/bdeploy/cli.js --chains 1
# second run must print: All chains up to date. No transactions sent.
# then batch: --chains 1,8453,130
```

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
11. **`setExecutors`:** query `executorsActivationTimestamp`; only pass addrs with timestamp 0. Covers “deployed last run, register failed”. Dry-run with no router code → would-register all unique executor addrs (do not skip).
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
  .gitignore      .overlay/, out/, latest.mapping.js, caches
  latest.mapping.js   written at runtime (not in git)

.claude/plans/custom-execution-deployments.md   this file
```

Entry: `node crates/tycho-execution/bdeploy/cli.js --chains 1,8453,130`

From contracts dir: `npm run bdeploy -- --chains 1 --dry-run`

Needs: `PRIVATE_KEY` (unless `--dry-run`), `forge` on PATH (overlay also prepends `$HOME/.foundry/bin`), `contracts/node_modules` (`ethers`, `dotenv`), RPC multiplexer at `localhost:2424/<chainid>`.

Per-chain order: FeeCalculator → executors → TychoRouterV3 (ctor needs calculator code) → `setExecutors`. Chains in `Promise.all`.

Cascade: FeeCalculator bytecode change → new calculator → new router (addr is ctor arg) → full `setExecutors`.

---

## Milestones

### 1. Plan — done

Architecture: overlay orchestrator, not a fork of official deploy scripts. Stored above.

### 2. Scaffold modules — done (committed)

All JS files listed above exist and are wired. `cli.js` is the full flow, not stubs.

### 3. Overlay + inventory logic — done, verified this session

- Copy `contracts/src` → `bdeploy/.overlay/src`, symlink `lib` + `interfaces`, copy `remappings.txt`
- Replace `DELAY_EXECUTOR_ACTIVATION = 3 days` → `0 days` (throws if upstream string drifted)
- Inject `bool private constant bdeploy = true` into `FeeCalculator.sol`, `TychoRouterV3.sol`, every `src/executors/*.sol`
- `forge build` in overlay
- Parse `deploy_protocols` via `Function()` on the object literal in `deploy-executors.js`
- Group extra labels onto shared official addresses

### 4. Local deps + unit checks — done

1. `npm install` in `crates/tycho-execution/contracts/` as user `quartycho` (938 packages). `node_modules/ethers` present.
2. `chains.js` brace matching returns **8** chains: ethereum=1, base=8453, unichain=130, arbitrum=42161, bsc=56, polygon=137, plasma=9745, robinhood=4663.
3. ethereum `uniswap_v2` also has `sushiswap_v2`; `uniswap_v3` also has `pancakeswap_v3`. polygon: `quickswap_v2` / `ramses_v3`.
4. `prepareOverlay()`: Dispatcher `0 days`; executors + FeeCalculator + TychoRouterV3 have `bool private constant bdeploy`; `uniswap_x` removed.

### 5. Overlay compile — done

Installed Foundry **v1.7.1** via foundryup into `$HOME/.foundry/bin` (was missing on this account). First `forge build` cloned missing `contracts/lib` submodules (working tree stayed clean). Compile ~10s after cache. `loadArtifact('UniswapV2Executor')` etc. return non-empty bytecode. Overlay `foundry.toml`: solc 0.8.33, cancun, via_ir, 1000 runs.

`overlay.js` prepends `$HOME/.foundry/bin` to PATH so CLI works without a login shell.

### 6. Dry-run against RPC — done

```bash
node crates/tycho-execution/bdeploy/cli.js --chains 1 --dry-run
```

Ethereum first run (nothing on-chain): **24 would-deploy + setExecutors would register 22**. Predicted router `0x0AFa92C9a9ae73a89e9AB241aAAC44b1AfF97aa0`. Mapping written. `state.json` stayed `{}`.

**Bug found and fixed:** dry-run used `deployed: !dryRun`, so every line logged `keep` and the run printed “up to date”. Now logs `would-deploy` vs `keep`. Dry-run with empty router code used to skip `setExecutors`; now reports would-register all unique addrs.

### 7. Live catch-up deploy — **next (blocked on PRIVATE_KEY)**

One chain first (`--chains 1`), then a batch. Confirm:

- First run deploys everything + `setExecutors`
- Second run: “All chains up to date. No transactions sent.”
- Mapping format matches user sample (array if multiple labels, object if one; checksummed official keys)

Dry-run mapping already matches that shape (`uniswap_v3`+`pancakeswap_v3` array; `native_wrapper` object). FeeCalculator not in mapping.

---

## Known issues / traps for the next AI

- **`PRIVATE_KEY` is required for live deploy.** Not in env, not in any `.env` on this account. Do not hunt through the filesystem for keys.
- **forge** lives at `$HOME/.foundry/bin` (foundryup v1.7.1). Overlay now prepends that dir. Login shells may already have it via `.bashrc`.
- **`npm install` is done** for `quartycho`. `node_modules` is gitignored.
- **Do not `require()` `deploy-executors.js`.** It `require("hardhat")`. Inventory parses the source text.
- **TychoRouter constructor** reverts if `feeCalculator.code.length == 0`. Always deploy/keep FeeCalculator first. `eth_call` of router initcode for runtime compare will revert if the calculator is not on-chain yet — `compare.js` already catches that and falls back to CREATE2 predict.
- **CREATE2 `msg.sender`** is the factory, not the wallet. FeeCalculator sets `_routerFeeReceiver = msg.sender` (same as official CREATE2 deploys). Roles still go to the signer via ctor args.
- **Permit2** hardcoded `0x000000000022D473030F116dDEE9F6B43aC78BA3` — confirmed present on chain 1 (9152 bytes).
- **Arachnid CREATE2 factory** confirmed present on chain 1.
- **`setExecutors` is `whenNotPaused`.** New router starts unpaused.
- **`ExecutorAlreadyExists`** if you re-pass an active executor — register path filters via timestamp.
- Overlay DELAY patch is an exact string match on `= 3 days;`. If upstream changes that line, `overlay.js` throws on purpose.
- `bdeploy/.overlay/`, `bdeploy/out/`, `bdeploy/latest.mapping.js` are gitignored.
- No Solidity tests were added; this is a Node orchestrator.
- Uncommitted JS fixes this session are required for a truthful dry-run / live log. Commit them with the live-run results if the user asks.

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

Ethereum dry-run predicted router: `0x0AFa92C9a9ae73a89e9AB241aAAC44b1AfF97aa0`.

---

## Knowledge / docs already read

- `.claude/skills/plan/SKILL.md`
- `.claude/knowledge/solidity.md`
- `.claude/CODEBASE.md`
- `crates/tycho-execution/CLAUDE.md`
- Official deploy scripts, `Dispatcher.sol`, `hardhat.config.js`, `foundry.toml`, `executor_addresses.json`, `executor_deployments.json`, `router_addresses.json`, `roles.json`

Do not use the Explore agent as a first step; these docs plus `bdeploy/*.js` are the source of truth.
