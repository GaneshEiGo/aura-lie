// packages/kill-switch-audit/src/sha256.ts
// Pure, synchronous SHA-256. Works in Worker, browser, Node, and tests
// without depending on crypto.subtle being available.
// Reference: FIPS 180-4.
//
// Verified against the three FIPS known-answer vectors:
//   sha256('')   = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
//   sha256('abc')= ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
//   sha256('The quick brown fox jumps over the lazy dog')
//                = d7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592

const K = new Int32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(x: number, n: number): number {
  return ((x >>> n) | (x << (32 - n))) | 0;
}

export function sha256(input: string): Uint8Array {
  const bytes = new TextEncoder().encode(input);
  const bitLength = bytes.length * 8;

  // Padding: 0x80 then zeros then 64-bit big-endian bit length.
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;

  // Write 64-bit bit length at the end (big-endian).
  // For inputs < 2^32 bits the high 4 bytes are always 0.
  const padView = new DataView(padded.buffer);
  padView.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000), false);
  padView.setUint32(paddedLength - 4, bitLength >>> 0, false);

  let h0 = 0x6a09e667 | 0;
  let h1 = 0xbb67ae85 | 0;
  let h2 = 0x3c6ef372 | 0;
  let h3 = 0xa54ff53a | 0;
  let h4 = 0x510e527f | 0;
  let h5 = 0x9b05688c | 0;
  let h6 = 0x1f83d9ab | 0;
  let h7 = 0x5be0cd19 | 0;

  const w = new Int32Array(64);
  const view = padView;

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getInt32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[i] + w[i]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) | 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) | 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) | 0;
    }

    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
    h5 = (h5 + f) | 0;
    h6 = (h6 + g) | 0;
    h7 = (h7 + h) | 0;
  }

  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  outView.setInt32(0, h0, false);
  outView.setInt32(4, h1, false);
  outView.setInt32(8, h2, false);
  outView.setInt32(12, h3, false);
  outView.setInt32(16, h4, false);
  outView.setInt32(20, h5, false);
  outView.setInt32(24, h6, false);
  outView.setInt32(28, h7, false);
  return out;
}

export function sha256Hex(input: string): string {
  const bytes = sha256(input);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}