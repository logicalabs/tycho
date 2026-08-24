# Custom tycho-execution deployments (bdeploy)

## Goal

Keep a private parallel deployment of every tycho-execution contract, easy to
refresh after upstream merges, with distinct bytecode and zero executor
timelock. Differential: deploy nothing when already current; catch up when
partial; full suite when empty.

## Must have

- Overlay compile (no committed `.sol` edits)
- `DELAY_EXECUTOR_ACTIVATION = 0`
- Distinct bytecode via `bool private constant bdeploy = true` injected into
  deployed contracts only
- RPC `http://localhost:2424/<chainid>` for all calls
- Caller supplies chain IDs; name lookup from official Hardhat config
- On-chain runtime vs compiled as redeploy signal
- `TychoRouter.setExecutors` for any executor not yet registered
- Timestamped official → `bdeployAddress` mapping every run
- UniswapXFiller skipped

## Approach

Additive orchestrator at `crates/tycho-execution/bdeploy/`. Overlay-copies
`contracts/src` to a temp Foundry project, patches DELAY, injects the constant,
compiles once (viaIR, 1000 runs, cancun, solc 0.8.33). Per chain in parallel:
CREATE2-deploy only drifted/missing contracts, then `setExecutors` for
unregistered executors. Always write mapping + state.

## Inventory

- `deploy_protocols` parsed from official `deploy-executors.js`
- `config/executor_deployments.json` (contract + ctor args)
- `config/executor_addresses.json` (official addr + extra labels)
- `config/router_addresses.json`
- FeeCalculator + TychoRouterV3 on every chain that has official inventory

## Chain selection

`node bdeploy/cli.js --chains 1,8453,130`

`--chains` omitted → all non-tenderly networks in official `hardhat.config.js`.
Unknown chain ID fails. RPC is always `http://localhost:2424/<chainid>`.

## Redeploy / catch-up

CREATE2 factory `0x4e59b44847b379578588920cA78FbF26c0B4956C`, salt
`bdeploy:<contract>:<args>` (no network, so identical initcode shares an
address across chains).

Keep if predicted CREATE2 address already has code, or recorded address runtime
matches compiled. Else deploy. Query `executorsActivationTimestamp` and
`setExecutors` only missing addrs (covers failed register on a prior run).

FeeCalculator change → new calculator → new router (ctor arg) → full
`setExecutors`.

## Outputs

- `bdeploy/state.json` (machine state)
- `bdeploy/out/<timestamp>.mapping.js` + `latest.mapping.js`
- `CUSTOM_TYCHO_ROUTER` is a per-chain object
- FeeCalculator in state only
- No explorer / Tenderly verify

## Roles

Constructor roles (pauser, unpauser, executor setter, fee setter) = signer from
`PRIVATE_KEY`. Direct EOA txs, no Safe.
