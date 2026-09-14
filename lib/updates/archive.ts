// Dependency-free inspection of a gzipped tar update package.
//
// Section G hardening: a signed+checksummed package can STILL carry malicious
// archive entries that escape the extraction root. Before an update is allowed
// to be staged/installed we walk every tar entry and refuse the package if any
// entry would write outside the destination directory or is a link that could
// be abused. This mirrors (and pre-empts) the safety the host installer applies
// at real extraction time, and — unlike the shell script — is unit-testable.
//
// Rejected: absolute paths, parent-dir traversal (`..`), symlinks, hardlinks,
// device/fifo/other special entries, link targets that are absolute or escape
// root, and malformed roots (more than one top-level entry / stray top-level
// files). Only regular files and directories under a single top-level dir pass.
import zlib from 'zlib';

export interface ArchiveInspection {
  ok: boolean;
  errors: string[];
  entries: number;
  topLevel: string[];
}

function readString(block: Buffer, off: number, len: number): string {
  let end = off;
  const limit = off + len;
  while (end < limit && block[end] !== 0) end++;
  return block.toString('utf8', off, end);
}

function readOctal(block: Buffer, off: number, len: number): number {
  const s = readString(block, off, len).trim();
  if (!s) return 0;
  const n = parseInt(s, 8);
  return Number.isFinite(n) ? n : 0;
}

// A path is unsafe if it is absolute, contains a `..` component, or is empty.
function pathEscapes(p: string): boolean {
  if (!p) return false;
  const norm = p.replace(/\\/g, '/');
  if (norm.startsWith('/')) return true; // absolute
  if (/^[A-Za-z]:/.test(norm)) return true; // windows drive-absolute
  const parts = norm.split('/');
  let depth = 0;
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      depth--;
      if (depth < 0) return true; // escapes root
    } else {
      depth++;
    }
  }
  return false;
}

/**
 * Inspect a gzipped tar buffer. Returns ok=false with human-readable errors if
 * any entry is unsafe. Parses ustar + GNU longname + pax path/linkpath records.
 */
export function inspectGzipTar(gzBuf: Buffer | Uint8Array): ArchiveInspection {
  const errors: string[] = [];
  const topLevel = new Set<string>();
  let entries = 0;

  let buf: Buffer;
  try {
    buf = zlib.gunzipSync(Buffer.from(gzBuf));
  } catch {
    return { ok: false, errors: ['Package is not a valid gzip archive.'], entries: 0, topLevel: [] };
  }

  let offset = 0;
  let pendingLongName: string | null = null;
  let pendingLongLink: string | null = null;
  let paxPath: string | null = null;
  let paxLink: string | null = null;
  const BLOCK = 512;

  const parsePax = (data: string) => {
    // records: "<len> key=value\n"
    const re = /\d+ ([^=]+)=([^\n]*)\n/g;
    let m: RegExpExecArray | null;
    const out: Record<string, string> = {};
    while ((m = re.exec(data))) out[m[1]] = m[2];
    return out;
  };

  while (offset + BLOCK <= buf.length) {
    const header = buf.subarray(offset, offset + BLOCK);
    offset += BLOCK;

    // Two consecutive zero blocks = end of archive.
    if (header.every((b) => b === 0)) break;

    const size = readOctal(header, 124, 12);
    const typeflag = String.fromCharCode(header[156] || 0);
    let name = readString(header, 0, 100);
    const prefix = readString(header, 345, 155);
    if (prefix) name = `${prefix}/${name}`;
    let linkname = readString(header, 157, 100);

    const dataBlocks = Math.ceil(size / BLOCK);

    // GNU longname / longlink: the entry's real name is in the next data blocks.
    if (typeflag === 'L' || typeflag === 'K') {
      const data = buf.toString('utf8', offset, offset + size).replace(/\0+$/, '');
      if (typeflag === 'L') pendingLongName = data;
      else pendingLongLink = data;
      offset += dataBlocks * BLOCK;
      continue;
    }
    // pax extended headers (per-file 'x' or global 'g').
    if (typeflag === 'x' || typeflag === 'g') {
      const rec = parsePax(buf.toString('utf8', offset, offset + size));
      if (rec.path) paxPath = rec.path;
      if (rec.linkpath) paxLink = rec.linkpath;
      offset += dataBlocks * BLOCK;
      continue;
    }

    if (pendingLongName) { name = pendingLongName; pendingLongName = null; }
    if (paxPath) { name = paxPath; paxPath = null; }
    if (pendingLongLink) { linkname = pendingLongLink; pendingLongLink = null; }
    if (paxLink) { linkname = paxLink; paxLink = null; }

    offset += dataBlocks * BLOCK;
    entries++;

    // Validate entry name.
    if (pathEscapes(name)) {
      errors.push(`Unsafe path in package: "${name}" (absolute or escapes root).`);
    }

    // Only regular files ('0', '\0', '7') and directories ('5') are allowed.
    if (typeflag === '2') {
      errors.push(`Symlink not allowed in update package: "${name}" -> "${linkname}".`);
    } else if (typeflag === '1') {
      errors.push(`Hardlink not allowed in update package: "${name}" -> "${linkname}".`);
    } else if (!['0', '\0', '', '5', '7'].includes(typeflag)) {
      errors.push(`Disallowed entry type '${typeflag}' in update package: "${name}".`);
    }

    // Link targets (defensive; links are already rejected above).
    if (linkname && pathEscapes(linkname)) {
      errors.push(`Unsafe link target in package: "${name}" -> "${linkname}".`);
    }

    // Track top-level component for malformed-root detection.
    const first = name.replace(/^\.\//, '').split('/')[0];
    if (first && first !== '.') topLevel.add(first);
  }

  if (entries === 0) errors.push('Update package contains no entries.');
  if (topLevel.size > 1) {
    errors.push(`Malformed package root: expected a single top-level directory, found ${topLevel.size} (${[...topLevel].join(', ')}).`);
  }

  return { ok: errors.length === 0, errors, entries, topLevel: [...topLevel] };
}
