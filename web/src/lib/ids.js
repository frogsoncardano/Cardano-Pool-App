// Pool and DRep id helpers (no network needed)
const B32 = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
function polymod(v) {
  const G = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let c = 1;
  for (const x of v) {
    const b = c >> 25;
    c = ((c & 0x1ffffff) << 5) ^ x;
    for (let i = 0; i < 5; i++) if ((b >> i) & 1) c ^= G[i];
  }
  return c;
}
function toBech32(hrp, bytes) {
  let acc = 0, bits = 0;
  const d = [];
  for (const v of bytes) {
    acc = (acc << 8) | v;
    bits += 8;
    while (bits >= 5) { bits -= 5; d.push((acc >> bits) & 31); }
  }
  if (bits > 0) d.push((acc << (5 - bits)) & 31);
  const exp = [...hrp].map((c) => c.charCodeAt(0) >> 5).concat([0], [...hrp].map((c) => c.charCodeAt(0) & 31));
  const pm = polymod(exp.concat(d, [0, 0, 0, 0, 0, 0])) ^ 1;
  const cs = [];
  for (let i = 0; i < 6; i++) cs.push((pm >> (5 * (5 - i))) & 31);
  return hrp + '1' + d.concat(cs).map((x) => B32[x]).join('');
}
// pool1... (bech32) or 56-char hex  ->  pool1...   (null if it is neither)
export function normalizePoolId(input) {
  const v = String(input || '').trim();
  if (/^pool1[0-9a-z]{50,60}$/i.test(v)) return v.toLowerCase();
  if (/^[0-9a-f]{56}$/i.test(v)) return toBech32('pool', v.match(/../g).map((h) => parseInt(h, 16)));
  return null;
}
// drep1... / drep_script1... (CIP-105 or CIP-129)
export const isDRepId = (input) => /^drep(_script)?1[0-9a-z]{30,70}$/i.test(String(input || '').trim());
export const short = (s, n = 8) => (s && s.length > n * 2 + 3 ? `${s.slice(0, n)}…${s.slice(-n)}` : s || '');
export const ada = (lovelace) => Number(lovelace || 0) / 1e6;
export const fmtAda = (lovelace, digits = 2) => ada(lovelace).toLocaleString('en-US', { maximumFractionDigits: digits }) + ' ₳';
