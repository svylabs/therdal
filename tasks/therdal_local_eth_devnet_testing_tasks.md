# Local Ethereum Devnet & Stakeholder Voting Test Suite (Stake, EOA & Smart Accounts)

## Feature Summary

Provide a turnkey local Ethereum testing environment, cross-layer live JSON-RPC proof builders, smart-account voting harnesses, end-to-end automated integration tests, and comprehensive testing best-practices documentation for the Therdal protocol:

1. **Local Ethereum Node Bootstrap (`script/devnet/local-devnet.mjs`)**:
   - Launches a local Cancun-enabled `anvil` node (`chainId = 31337`) with deterministic accounts.
   - Etches `MockSystemRootOracle` at canonical EIP-4788 (`0x000F3df6D732807Ef1319fB7B8bB8522d0Beac02`) and EIP-2935 (`0x0000F90827F1C53a10cb7A02335B175320002935`) system contract addresses so Beacon Chain SSZ stake proofs and historical block hash lookups behave identically to Ethereum Mainnet.
   - Deploys `MockStablecoin` (6-decimal USDC), `TherdalController`, `Therdal`, and funded `MockERC4337SmartAccount` instances.
   - Mines a canonical post-genesis snapshot block (`>= 1` so Anvil computes full Merkle Patricia Trie `stateRoot`), constructs a multi-validator SHA-256 SSZ `BeaconState` + `BeaconBlockHeader` aligned to `snapshotBlockHash` (`0x01` ETH1 and `0x02` Pectra compounding credentials across EOA and Smart Account withdrawal addresses), pins EIP-4788 `parentBeaconBlockRoot`, registers a sample open topic, and writes `.therdal-devnet.json`.

2. **Live RPC Header/MPT Encoders & Multi-Validator SSZ Fixture Builder (`sdk/src/rpcProofs.ts`)**:
   - `encodeRpcBlockHeaderToRlp`: Reconstructs canonical Yellow Paper / Cancun / Prague RLP block headers directly from `eth_getBlockByNumber` JSON-RPC responses and verifies `keccak256(rlpHeader) == block.hash`.
   - `encodeRpcAccountProofNodes`: Encodes `eth_getProof` `accountProof` arrays into canonical RLP node lists for `Therdal.voteWithExecutionBalance` and `Therdal.voteDirect`.
   - `buildMultiValidatorBeaconFixture`: Builds shared depth-40 `List[Validator, 2**40]` SSZ Merkle trees and aligned `BeaconSnapshotAuthProof` + per-validator `ValidatorStakeProof` bundles for arbitrary combinations of EOA and Smart Account validators.

3. **Smart Account & Validator Stake Testing (`test/helpers/SmartAccountHelpers.sol`, `test/contracts/SmartAccountAndStakeVoting.t.sol`, `script/devnet/devnet-e2e.test.mjs`)**:
   - `MockERC4337SmartAccount`: Supports direct owner `execute` / `executeBatch`, ERC-4337-style relayed `executeWithSignature` (bundler pays gas while `msg.sender` at `Therdal.sol` is the Smart Account), and ERC-1271 `isValidSignature`.
   - Full Foundry unit/adversarial tests and live ephemeral-Anvil E2E tests covering EOA balance voting, EOA `0x01`/`0x02` stake voting, atomic `voteDirect`, Smart Account `execute` voting, bundler-relayed Smart Account voting, post-snapshot transfer invariance, root-authentication caching, and replay/double-vote reverts.

4. **Synchronized Protocol & Website Documentation (`docs/local-testing.md`, `README.md`, `website/docs.html`, `website/src/docs-v10.js`)**:
   - Documents local node setup, the 4-tier Ethereum testing pyramid, Anvil vs Archive Fork vs Kurtosis tradeoffs, critical EVM/Anvil pitfalls, and concrete CLI/SDK testing workflows.

---

## Architecture

```
┌────────────────────────────────────────────────────────────────────────────────┐
│              Therdal Local Ethereum Devnet & Stakeholder Test Stack            │
├────────────────────────────────────────────────────────────────────────────────┤
│  Solidity Smart Account & Proof Harnesses                                      │
│  ├── test/helpers/SmartAccountHelpers.sol      : ERC-4337/1271 Smart Account   │
│  └── test/contracts/SmartAccountAndStakeVoting.t.sol : Foundry EOA/AA/Stake    │
├────────────────────────────────────────────────────────────────────────────────┤
│  SDK Live JSON-RPC & Multi-Validator Builders (sdk/)                           │
│  ├── sdk/src/rpcProofs.ts                      : RPC -> RLP Header/MPT + SSZ   │
│  └── sdk/test/rpcProofs.test.ts                : Unit & vector tests           │
├────────────────────────────────────────────────────────────────────────────────┤
│  Local Anvil Node Orchestration & Live E2E Suite (script/devnet/)              │
│  ├── script/devnet/local-devnet.mjs            : Bootstrap/seed/demo CLI       │
│  └── script/devnet/devnet-e2e.test.mjs         : Ephemeral Anvil E2E test run  │
├────────────────────────────────────────────────────────────────────────────────┤
│  Documentation Sync                                                            │
│  ├── docs/local-testing.md & README.md         : Devnet & Best Practices Guide │
│  └── website/docs.html & website/src/docs-v10.js : Two-pane Docs Portal sync   │
└────────────────────────────────────────────────────────────────────────────────┘
```

---

## Task List

| Task | Description | Status |
| --- | --- | --- |
| 1 | Implement `MockERC4337SmartAccount` (`test/helpers/SmartAccountHelpers.sol`) and Foundry test suite (`test/contracts/SmartAccountAndStakeVoting.t.sol`) covering EOA, Smart Account (`execute` & relayed `executeWithSignature`), `TherdalController`, and `0x01`/`0x02` validator stake voting | Complete |
| 2 | Implement live JSON-RPC RLP block header encoder, `eth_getProof` encoder, and multi-validator SSZ fixture builder in `@therdal/sdk` (`sdk/src/rpcProofs.ts`, `sdk/src/index.ts`, `sdk/test/rpcProofs.test.ts`) | Complete |
| 3 | Implement local Anvil devnet bootstrap/demo script (`script/devnet/local-devnet.mjs`), live ephemeral-Anvil E2E test suite (`script/devnet/devnet-e2e.test.mjs`), `.gitignore` entry for `.therdal-devnet.json`, and `package.json` scripts | Complete |
| 4 | Synchronize documentation across `docs/local-testing.md`, `README.md`, `website/docs.html`, and `website/src/docs-v10.js`, and start/verify the local Anvil node | Complete |
