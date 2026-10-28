// Turn the many ways a wallet or the builder can fail into something a person can act on.
export function friendlyError(e) {
  const msg = String((e && (e.info || e.message)) || e || '');
  if (/declin|cancel|reject|refus|user abort|code[": ]+-?3/i.test(msg)) return 'You cancelled the request in your wallet. Nothing was sent.';
  if (/insufficient|not enough|utxo balance|input selection|UTxO Balance Insufficient/i.test(msg)) return 'Your wallet does not have enough free ADA for the fee (and the refundable deposit if this is your first stake). Add about 3 ADA and try again.';
  if (/stake.*(not )?registered|StakeKeyNotRegistered/i.test(msg)) return 'Your stake address is not registered yet. Try again; the app will include the registration.';
  if (/ConwayWdrlNotDelegatedToDRep|not delegated to.*drep|DRep/i.test(msg) && /withdr/i.test(msg)) return 'Rewards can only be withdrawn after you delegate your voting power. Use the "Voting power" tab first.';
  return msg.length > 220 ? msg.slice(0, 220) + '…' : msg || 'Something went wrong.';
}
