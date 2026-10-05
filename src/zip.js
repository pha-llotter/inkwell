import zlib from 'node:zlib';

/**
 * A minimal ZIP writer, store-only (no compression).
 *
 * A dependency would do this, but the entries here are PNGs — already
 * compressed, so deflating them again costs time and saves almost nothing.
 * What is left is a container format, and writing it is cheaper than carrying
 * a library and its transitive tree for the rest of the app's life.
 */

const DOS_EPOCH = new Date(1980, 0, 1);

function dosDateTime(date) {
  const d = date instanceof Date && !Number.isNaN(date) && date >= DOS_EPOCH ? date : DOS_EPOCH;
  const time = ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff;
  const day = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff;
  return { time, day };
}

/**
 * @param {{name: string, data: Buffer, date?: Date}[]} entries
 * @returns {Buffer}
 */
export function zipStore(entries) {
  const locals = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    // The spec requires forward slashes and no leading slash.
    const name = Buffer.from(String(entry.name).replace(/\\/g, '/').replace(/^\/+/, ''), 'utf8');
    const data = entry.data;
    const crc = zlib.crc32(data) >>> 0;
    const { time, day } = dosDateTime(entry.date);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);   // local file header
    local.writeUInt16LE(20, 4);           // version needed
    local.writeUInt16LE(0x0800, 6);       // UTF-8 filename flag
    local.writeUInt16LE(0, 8);            // method 0 = stored
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); // compressed size
    local.writeUInt32LE(data.length, 22); // uncompressed size
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);           // extra field length
    locals.push(local, name, data);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);     // central directory header
    dir.writeUInt16LE(20, 4);             // version made by
    dir.writeUInt16LE(20, 6);             // version needed
    dir.writeUInt16LE(0x0800, 8);
    dir.writeUInt16LE(0, 10);
    dir.writeUInt16LE(time, 12);
    dir.writeUInt16LE(day, 14);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(data.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt16LE(0, 30);             // extra
    dir.writeUInt16LE(0, 32);             // comment
    dir.writeUInt16LE(0, 34);             // disk number
    dir.writeUInt16LE(0, 36);             // internal attrs
    dir.writeUInt32LE(0, 38);             // external attrs
    dir.writeUInt32LE(offset, 42);        // offset of local header
    central.push(dir, name);

    offset += local.length + name.length + data.length;
  }

  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);       // end of central directory
  end.writeUInt16LE(0, 4);                // this disk
  end.writeUInt16LE(0, 6);                // disk with central dir
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);               // comment length

  return Buffer.concat([...locals, centralBuf, end]);
}
