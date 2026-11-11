# Therdal Protocol v0.2 — Deposits, Sponsorship, 25/25/50 Fee Split & Refunds

## 1. Payment Asset & Smart-Account Controller (`TherdalController.sol`)

- **Initial Asset**: **USDC** (`6` decimals: `$1.00 = 1_000_000` units).
- **Extensible Stablecoin Support**: `TherdalController` maintains an allowlist of USD stablecoins (`USDC`, and optionally `USDT`, `PYUSD`, `DAI`, `USDS`) with each token's `decimals` (`>= 6`), scaling USD micro-prices (`1e6`) cleanly to token base units via `amount = usdMicros * 10**(decimals - 6)`.
- **Smart-Account Governance**:
  - `TherdalController` is initially operated by a single signer (`operator`), with `transferOperator(address newOperatorOrDao)` so control can transition seamlessly to a DAO / Timelock.
  - `TherdalController` is the initial **Protocol Developer** recipient, holding earned developer settlement shares (`25%`), with `withdrawToken` and generic `execute` smart-account capabilities.
  - **Market-Updated Fee Parameters**: Per-vote fee parameters (`~$0.01 / vote` estimated) are constantly updated via `TherdalController` to reflect market realities (Ethereum gas, EIP-4844 blob costs, and off-chain STARK proving costs).

---

## 2. Free Topic Creation ($0 Fee) & Optional Sponsorship Escrow

1. **Always Free Creation (`$0` Deposit & `$0` Fee)**: Anyone can call `createTopic(subject, options, votingEndsAt, initialSponsorship)` (with `initialSponsorship = 0`) to register a topic / referendum for free (`0 USDC` upfront deposit required and `$0` protocol creation fee). Direct on-chain voting also carries `$0` protocol fee.
2. **Optional Sponsorships (`100%` to Pool)**: Anyone (the creator via `initialSponsorship` or community sponsors via `sponsorTopic(topicId, amount)`) can optionally deposit USD stablecoins while the topic is `Open` to fund gas-free offline voting. **100%** of sponsored funds enter `remainingEscrow[topicId]` and `sponsorContributions[topicId][sponsor]` with zero creation or deposit fee.
   - At an estimated `~$0.01` (`10_000` USDC units) per newly accepted valid vote (`~$10` per `1,000` votes), an optional `$100` (`100_000_000` USDC units) sponsorship funds **~10,000 accepted votes**.
3. **Frozen Topic Pricing**: While `TherdalController` constantly updates fee parameters (`pricePerVoteUsdMicros`) for new topics to reflect market realities, each topic freezes `paymentToken` and `pricePerVote` at creation so future controller price changes never retroactively reprice an active topic's escrow.

---

## 3. Verified Settlement Fee & 25% / 25% / 50% Revenue Split

When `settleBatch` proves a valid transition with `newlyAcceptedVoteCount` newly accepted valid votes:
```solidity
uint256 totalFee = newlyAcceptedVoteCount * state.pricePerVote;
if (totalFee > remainingEscrow[resolutionId]) {
    revert InsufficientEscrowBalance(totalFee, remainingEscrow[resolutionId]);
}
```
If `totalFee > 0`, `remainingEscrow[resolutionId]` decreases by `totalFee` and `totalFee` (`F`) is split (example shown at the estimated `$0.01 / vote` rate):

| Recipient | Share | Formula | At 1,000 Votes (~$10 Est.) | At 10,000 Votes (~$100 Pool Est.) |
| --- | --- | --- | --- | --- |
| **Protocol Developer (`TherdalController`)** | **25%** | `devShare = F / 4` | `$2.50` | `$25.00` |
| **Blob Submitter / Frontend (`batch.submitter`)** | **25%** | `submitterShare = F / 4` | `$2.50` | `$25.00` |
| **Successful STARK Prover (`msg.sender`)** | **50%** | `proverShare = F - devShare - submitterShare` | `$5.00` | `$50.00` |
| **Total** | **100%** | `F` | `$10.00` | `$100.00` |

- Submitters receive `$0` at blob publication; their `25%` share is unlocked strictly when a prover settles their batch.
- If a direct ERC-20 `transfer` to any recipient fails (e.g. blacklisted address), the exact share is credited to `claimableTokenRewards[token][recipient]` so settlement cannot be DoS-blocked.

---

## 4. Settlement Grace Period & Pro-Rata Pull Refunds

- Once all registered batches settle (`finalizeResolution`) **or** the settlement grace period expires (`block.timestamp > settlementDeadline` via `closeSettlementAndEnableRefunds`), settlement closes permanently and unused escrow is frozen:
  `U = frozenUnusedEscrow[resolutionId] = remainingEscrow[resolutionId]`.
- Every escrow contributor `i` (including the creator for any optional sponsorship contribution) can call `claimRefund(resolutionId)` once:
  ```solidity
  refund_i = (U * contributorEscrow[resolutionId][i]) / totalEscrowContributed[resolutionId];
  ```
- Rounding dust (`< number_of_contributors` atomic units) remains safely bounded in the escrow contract, satisfying `sum(refund_i) <= U`.
