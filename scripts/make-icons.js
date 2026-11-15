// Gera os ícones PNG da extensão sem dependências (balão de fala azul com um "T" branco).
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function draw(size) {
  const s = size;
  return (x, y) => {
    const u = (x + 0.5) / s, v = (y + 0.5) / s;
    // balão: retângulo arredondado + "rabinho"
    const inBox = u > 0.06 && u < 0.94 && v > 0.08 && v < 0.74;
    const r = 0.14;
    const cx = Math.min(Math.max(u, 0.06 + r), 0.94 - r), cy = Math.min(Math.max(v, 0.08 + r), 0.74 - r);
    const inRound = Math.hypot(u - cx, v - cy) <= r;
    const inTail = v >= 0.72 && v < 0.94 && u > 0.2 && u < 0.2 + (0.94 - v) * 0.9;
    const bubble = (inBox && inRound) || inTail;
    if (!bubble) return [0, 0, 0, 0];
    // letra T branca
    const bar = v > 0.22 && v < 0.34 && u > 0.26 && u < 0.74;
    const stem = u > 0.44 && u < 0.56 && v > 0.22 && v < 0.62;
    if (bar || stem) return [255, 255, 255, 255];
    return [31, 139, 184, 255];
  };
}

const out = path.join(__dirname, '..', 'icons');
fs.mkdirSync(out, { recursive: true });
for (const size of [16, 32, 48, 128]) fs.writeFileSync(path.join(out, `icon${size}.png`), png(size, draw(size)));
console.log('icons written to', out);
