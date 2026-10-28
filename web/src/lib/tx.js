// Builds UNSIGNED transactions. Signing always happens inside the user's own wallet.
import { MeshTxBuilder, deserializePoolId } from '@meshsdk/core';
import { deserializeTx } from '@meshsdk/core-cst';

async function finish(txb, { utxos, changeAddress }) {
  return txb.changeAddress(changeAddress).selectUtxosFrom(utxos).complete();
}
function newBuilder({ network, fetcher }) {
  const txb = new MeshTxBuilder({ fetcher });
  txb.setNetwork(network);
  return txb;
}

// Delegate stake to a pool. Registers the stake address first if needed (that locks a refundable deposit).
export async function buildPoolDelegation(ctx) {
  const txb = newBuilder(ctx);
  if (ctx.register) txb.registerStakeCertificate(ctx.rewardAddress);
  txb.delegateStakeCertificate(ctx.rewardAddress, deserializePoolId(ctx.poolBech32));
  return finish(txb, ctx);
}

// Delegate voting power: { dRepId } | { alwaysAbstain: null } | { alwaysNoConfidence: null }
export async function buildVoteDelegation(ctx) {
  const txb = newBuilder(ctx);
  if (ctx.register) txb.registerStakeCertificate(ctx.rewardAddress);
  txb.voteDelegationCertificate(ctx.drep, ctx.rewardAddress);
  return finish(txb, ctx);
}

// Withdraw staking rewards (Cardano only allows this once voting power is delegated).
export async function buildWithdrawal(ctx) {
  const txb = newBuilder(ctx);
  txb.withdrawal(ctx.rewardAddress, String(ctx.rewardLovelace));
  return finish(txb, ctx);
}

// What the transaction really contains, read back from the bytes we are about to ask the wallet to sign.
export function describeTx(hex) {
  const body = deserializeTx(hex).body();
  const certs = body.certs() ? body.certs().values().map((c) => c.toCore()) : [];
  const wd = body.withdrawals ? body.withdrawals() : null;
  const withdrawals = wd && wd.entries ? [...wd.entries()].map(([addr, amount]) => ({ address: String(addr), lovelace: String(amount) })) : [];
  return {
    feeLovelace: String(body.fee()),
    registersStake: certs.some((c) => c.__typename === 'StakeRegistrationCertificate'),
    delegatesToPool: certs.find((c) => c.__typename === 'StakeDelegationCertificate')?.poolId || null,
    voteDelegation: certs.find((c) => c.__typename === 'VoteDelegationCertificate')?.dRep || null,
    withdrawals,
  };
}
