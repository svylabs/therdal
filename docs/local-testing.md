# Local Ethereum Devnet & Testing Best Practices

This guide covers spinning up a local Ethereum node (`anvil`) pre-seeded with Therdal contracts, Beacon Chain validator stakes (`0x01` & `0x02`), EOA wallets, and ERC-4337/ERC-1271 Smart Accounts, alongside engineering best practices for testing cryptographic state-proof protocols.

---

## 1. Quickstart Commands

```bash
# 1. Start a persistent local Ethereum devnet on http://127.0.0.1:8545 (writes .therdal-devnet.json)
npm run devnet:start

# 2. Run the live multi-stakeholder voting showcase against the running node (idempotent)
npm run devnet:demo

# 3. Run the self-contained ephemeral Anvil E2E test suite (spawns Anvil on a free port & tears down)
npm run devnet:smoke

# 4. Run Foundry unit, fuzz, smart-account, and adversarial Solidity tests
forge test -vv
```

---

## 2. Seeded Devnet Topology (`.therdal-devnet.json`)

When `npm run devnet:start` (or `npm run devnet:seed`) runs, `script/devnet/local-devnet.mjs` configures `anvil` (`chainId = 31337`, Cancun hardfork):

| Actor / Contract | Role & Seeded State |
| --- | --- |
| `EIP-4788` (`0x000F3df6D732807Ef1319fB7B8bB8522d0Beac02`) | Etched `MockSystemRootOracle` serving canonical `parentBeaconBlockRoot` by child block timestamp |
| `EIP-2935` (`0x0000F90827F1C53a10cb7A02335B175320002935`) | Etched `MockSystemRootOracle` serving historical execution `blockhash` beyond 256 blocks |
| `Therdal.sol` & `TherdalController.sol` | Deployed topic registry, direct snapshot voting verifier, and pricing/smart-account controller (`MockStablecoin` 6-decimal USDC) |
| **Account #0 (`deployer`)** | Protocol operator & topic creator; mints `10,000 USDC` and sponsors Topic #1 with `$100.00 USDC` |
| **Account #1 (`eoaAlice`)** | ~`10,000 ETH` wallet balance + **Validator `#0`** (`0x01` ETH1 credentials, `32 ETH`) + **Validator `#1`** (`0x02` Pectra compounding credentials, `64 ETH`) |
| **Account #2 (`eoaBob`)** | ~`10,000 ETH` wallet balance + **Validator `#2`** (`0x01` credentials, `32 ETH`) |
| **`SmartAccountA` (`MockERC4337SmartAccount`)** | Owned by Account #3; holds **`50 ETH`** contract balance + **Validator `#10`** (`0x01` credentials pointing to `SmartAccountA`, `128 ETH`). Votes via `execute(therdal, 0, calldata)` |
| **`SmartAccountB` (`MockERC4337SmartAccount`)** | Signed offline by Account #4, relayed by Account #5 (`bundlerRelayer`); holds **`120 ETH`** + **Validator `#512`** (`0x02` Pectra MaxEB credentials pointing to `SmartAccountB`, **`2,048 ETH`**). Votes via `executeWithSignature(...)` |

---

## 3. How EOA, Stake & Smart Account Voting Work Together

1. **EOA Execution Balance (`voteWithExecutionBalance` / `voteDirect`)**:
   - Queries live `eth_getBlockByNumber(snapshotBlock)` and `eth_getProof(eoa, [], snapshotBlock)`.
   - `@therdal/sdk`'s `encodeRpcBlockHeaderToRlp` reconstructs the canonical 20-field Cancun RLP header (`keccak256(rlpHeader) == snapshotBlockHash`), and `encodeRpcAccountProofNodes` wraps the EIP-1186 MPT trie path.
2. **Validator Stake (`voteWithBeaconStake` / `voteDirect`)**:
   - Authenticates `BeaconState` against the EIP-4788 `snapshotBeaconBlockRoot` and proves `BeaconState.latest_execution_payload_header.block_hash == snapshotBlockHash` (leaf index `780`).
   - Verifies depth-40 SHA-256 SSZ `Validator` branches for `0x01` (standard ETH1) and `0x02` (EIP-7251 Pectra compounding up to `2,048 ETH`) credentials where the 20-byte withdrawal address equals `msg.sender`.
3. **Smart Account Voting (Safe, Multisigs, DAO Timelocks, ERC-4337 Account Abstraction)**:
   - Because `Therdal.sol` authenticates `voter = msg.sender` and `MerklePatriciaProofVerifier.decodeAccount` decodes full `[nonce, balance, storageRoot, codeHash]` tuples, **any Smart Account is a first-class voter** for both contract-held ETH and validators whose `0x01`/`0x02` withdrawal address is the Smart Account:
     - **Direct Owner / Multisig Call**: `smartAccount.execute(address(therdal), 0, voteCalldata)`.
     - **Bundler / Relayer Call (Gasless Signer)**: Owner signs an EIP-712 operation offline; any relayer EOA submits `smartAccount.executeWithSignature(...)` (or ERC-4337 `EntryPoint.handleOps`), paying L1 gas while `msg.sender` at `Therdal.sol` is `smartAccount`.
     - **Offline Batch Path**: Smart Accounts implement ERC-1271 `isValidSignature(bytes32, bytes)` (`0x1626ba7e`).

---

## 4. Testing Best Practices: The 4-Tier Pyramid

| Tier | Tooling | Speed | What to Test Here |
| --- | --- | --- | --- |
| **1. Deterministic In-EVM Unit, Fuzz & Adversarial** | `forge test` (`test/contracts/`, `test/adversarial/`) | `< 250 ms` | Every custom revert error, malformed RLP/MPT/SSZ byte mutations, fuzzing boundaries, ERC-1271/4337 replay & expiry, access control, reentrancy, and cross-layer test vectors |
| **2. Ephemeral Live-RPC Node E2E** | `npm run devnet:smoke` (`anvil` on random free port) | `~1 s` | Real JSON-RPC serialization, live `eth_getProof` MPT trie generation over contract & EOA accounts, pre-block EIP-4788/2935 system calls, gas estimation, and receipt polling |
| **3. Pinned Archive Fork Testing** | `anvil --fork-url $MAINNET_ARCHIVE_RPC --fork-block-number 21500000` | `2–10 s` | Real Ethereum Mainnet/Hoodi RLP headers, real deployed Safe/ERC-4337 wallets, real USDC token quirks, and live Beacon API SSZ proofs |
| **4. Full EL + CL Local Devnet** | `kurtosis run github.com/ethpandaops/ethereum-package` (Reth/Geth + Lighthouse) | `1–3 min` | Real EIP-4844 Type-3 blob gossip/pruning, real Consensus Layer slot/epoch transitions, and end-to-end Aggregator + STARK Prover pipelines |

---

## 5. Critical EVM & Anvil Pitfalls to Avoid

1. **Never Use Genesis Block `0` for MPT Proofs on Anvil**:
   - Anvil leaves Block `0`'s header `stateRoot` as the empty trie hash (`0x56e81f17...`), whereas **every mined block `>= 1`** computes a genuine canonical Merkle Patricia Trie `stateRoot` matching `eth_getProof`. Always mine at least 1 block before `createTopic`.
2. **Never Call `anvil_setStorageAt` After Sealing `snapshotBlock`**:
   - Calling `anvil_setStorageAt` while `snapshotBlock` (`S`) is still `"latest"` mutates Anvil's in-memory state snapshot for block `S` *without* updating `S.stateRoot`, causing subsequent `eth_getProof(addr, [], S)` root hashes to diverge from `S.stateRoot` (`MPTNodeHashMismatch`).
   - **Best Practice**: Keep block `S` untouched. Disable automine (`evm_setAutomine(false)`), queue your EIP-4788 / EIP-2935 oracle updates as the **first transactions of block `S + 1`** ahead of `createTopic` (mirroring Ethereum's real pre-block system calls), then mine block `S + 1` with `evm_mine`.
3. **Etch System Contracts (`EIP-4788` & `EIP-2935`) on Standalone Anvil**:
   - Standalone Anvil has no Consensus Layer client, so `0x000F3df6D732807Ef1319fB7B8bB8522d0Beac02` and `0x0000F90827F1C53a10cb7A02335B175320002935` have empty code (`0x`) unless etched via `anvil_setCode` (in `local-devnet.mjs`) or `vm.etch` (in Foundry).
4. **Test Post-Snapshot Balance Transfer Invariance**:
   - Always include an explicit E2E test where a voter transfers ETH out *after* `createTopic` and then votes using `eth_getProof` at `snapshotBlock`—confirming historical weight is preserved and the recipient gains zero retroactive weight.
5. **Verify Authorization Boundaries Between Owner EOAs and Smart Accounts**:
   - If a validator's `0x01`/`0x02` withdrawal credential points to a Smart Account, verify that the Smart Account's owner EOA **reverts** with `UnauthorizedWithdrawalAddress` if calling `Therdal` directly (`msg.sender` must be the Smart Account itself).
6. **Poll Transaction Receipts Asynchronously**:
   - Over real HTTP JSON-RPC, `eth_getTransactionReceipt` can return `null` immediately after `eth_sendTransaction`. Always poll with a bounded timeout and assert `receipt.status === "0x1"`.
