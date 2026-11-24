// 从 WAV 头算时长。只需要文件前一两百字节，不必整读。
// 结构：RIFF <size> WAVE，然后一串 chunk（id 4 字节 + size 4 字节 + 内容，奇数长度补 1 字节）。
export function wavDurationMs(head: Uint8Array): number | null {
  if (head.length < 44) return null;
  const ascii = (from: number, len: number) => {
    let out = "";
    for (let i = 0; i < len; i += 1) out += String.fromCharCode(head[from + i]);
    return out;
  };
  if (ascii(0, 4) !== "RIFF" || ascii(8, 4) !== "WAVE") return null;

  const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
  let offset = 12;
  let byteRate = 0;
  while (offset + 8 <= head.length) {
    const id = ascii(offset, 4);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === "fmt " && body + 16 <= head.length) {
      byteRate = view.getUint32(body + 8, true);
    } else if (id === "data") {
      if (byteRate <= 0) return null;
      // 有些写入器把 data 长度留成 0，此时拿文件实际大小兜底由调用方处理。
      if (size === 0) return null;
      return Math.round((size / byteRate) * 1000);
    }
    offset = body + size + (size % 2);
  }
  return null;
}
