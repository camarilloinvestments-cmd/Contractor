// Section G acceptance: the update archive inspector must reject unsafe tar
// members (absolute paths, .. traversal, symlinks, hardlinks, special files,
// malformed multi-root layouts) and accept a clean single-root package.
import zlib from 'zlib';
import { inspectGzipTar } from '../../lib/updates/archive';

const BLOCK = 512;

function octal(n: number, len: number) {
  const s = n.toString(8);
  return s.padStart(len - 1, '0') + '\0';
}

// Build a minimal tar header block for one entry.
function header(name: string, typeflag: string, size: number, linkname = '') {
  const b = Buffer.alloc(BLOCK, 0);
  b.write(name.slice(0, 100), 0, 'utf8');
  b.write('0000644\0', 100); // mode
  b.write('0000000\0', 108); // uid
  b.write('0000000\0', 116); // gid
  b.write(octal(size, 12), 124);
  b.write(octal(Math.floor(Date.now() / 1000), 12), 136);
  b.write(typeflag, 156);
  if (linkname) b.write(linkname.slice(0, 100), 157, 'utf8');
  b.write('ustar\0', 257);
  b.write('00', 263);
  // checksum: fill with spaces, sum, then write.
  b.write('        ', 148);
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += b[i];
  b.write(octal(sum, 8).slice(0, 6) + '\0 ', 148);
  return b;
}

function entry(name: string, typeflag = '0', content = '', linkname = '') {
  const data = Buffer.from(content, 'utf8');
  const h = header(name, typeflag, typeflag === '5' ? 0 : data.length, linkname);
  const pad = data.length % BLOCK === 0 ? 0 : BLOCK - (data.length % BLOCK);
  return Buffer.concat([h, data, Buffer.alloc(pad, 0)]);
}

function tarGz(...parts: Buffer[]) {
  const end = Buffer.alloc(BLOCK * 2, 0);
  return zlib.gzipSync(Buffer.concat([...parts, end]));
}

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}`); }
}

// 1. Clean single-root package accepted.
check('clean single-root package accepted',
  inspectGzipTar(tarGz(entry('app/', '5'), entry('app/index.js', '0', 'console.log(1)'))).ok);

// 2. Absolute path rejected.
check('absolute path rejected',
  !inspectGzipTar(tarGz(entry('app/', '5'), entry('/etc/passwd', '0', 'x'))).ok);

// 3. Parent traversal rejected.
check('.. traversal rejected',
  !inspectGzipTar(tarGz(entry('app/', '5'), entry('app/../../evil.js', '0', 'x'))).ok);

// 4. Symlink rejected.
check('symlink rejected',
  !inspectGzipTar(tarGz(entry('app/', '5'), entry('app/link', '2', '', '/etc/passwd'))).ok);

// 5. Hardlink rejected.
check('hardlink rejected',
  !inspectGzipTar(tarGz(entry('app/', '5'), entry('app/hl', '1', '', '/etc/shadow'))).ok);

// 6. Special (char device) entry rejected.
check('device/special entry rejected',
  !inspectGzipTar(tarGz(entry('app/', '5'), entry('app/dev', '3', ''))).ok);

// 7. Malformed multi-root rejected.
check('malformed multi-root rejected',
  !inspectGzipTar(tarGz(entry('app/', '5'), entry('other/', '5'), entry('other/x.js', '0', 'x'))).ok);

// 8. Non-gzip garbage rejected.
check('non-gzip garbage rejected',
  !inspectGzipTar(Buffer.from('not a gzip at all')).ok);

// 9. Empty archive rejected.
check('empty archive rejected', !inspectGzipTar(tarGz()).ok);

console.log(`\n${pass}/${pass + fail} passed`);
if (fail > 0) process.exit(1);
