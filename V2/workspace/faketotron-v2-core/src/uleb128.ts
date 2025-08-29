export function encodeULEB128(n: number): Uint8Array {
  const bytes: number[] = [];
  let value = n >>> 0;
  do {
    let byte = value & 0x7f;
    value >>>= 7;
    if (value !== 0) byte |= 0x80;
    bytes.push(byte);
  } while (value !== 0);
  return Uint8Array.from(bytes);
}

export function decodeULEB128(buf: Uint8Array, offset = 0): { value: number; next: number } {
  let result = 0 >>> 0;
  let shift = 0;
  let i = offset;
  for (;;) {
    const byte = buf[i];
    result |= (byte & 0x7f) << shift;
    i++;
    if ((byte & 0x80) === 0) break;
    shift += 7;
    if (shift > 35) throw new Error("ULEB128 too large");
  }
  return { value: result >>> 0, next: i };
}
