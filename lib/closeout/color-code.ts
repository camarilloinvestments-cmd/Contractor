// Standard fiber optic color code (TIA-598-C). Generic, prime-agnostic helper
// used to auto-generate fiber positions for a cable and to label fibers on the
// generated splice workbook. NOT specific to any prime contractor.

// The 12 base colors, in order, with short codes matching the Comcast workbook
// abbreviations (BL, OR, GR, BR, SL, WH, RD, BK, YE, VI, RS, AQ).
export const FIBER_COLORS: { name: string; code: string; hex: string }[] = [
  { name: 'Blue', code: 'BL', hex: '#1f4fd8' },
  { name: 'Orange', code: 'OR', hex: '#f28c1e' },
  { name: 'Green', code: 'GR', hex: '#2e9e46' },
  { name: 'Brown', code: 'BR', hex: '#7a4a1e' },
  { name: 'Slate', code: 'SL', hex: '#8a8f98' },
  { name: 'White', code: 'WH', hex: '#f5f5f5' },
  { name: 'Red', code: 'RD', hex: '#d1332e' },
  { name: 'Black', code: 'BK', hex: '#1a1a1a' },
  { name: 'Yellow', code: 'YE', hex: '#f2c800' },
  { name: 'Violet', code: 'VI', hex: '#7a3ea6' },
  { name: 'Rose', code: 'RS', hex: '#e56aa0' },
  { name: 'Aqua', code: 'AQ', hex: '#3ec8c8' },
];

export const FIBER_COLOR_COUNT = FIBER_COLORS.length; // 12

// For binder groups beyond the first 12, the binder itself is striped
// ("Blue/Stripe", ...). This matches the Comcast workbook's 24-group / 288-fiber
// layout. Returns a display name for the binder group at zero-based index g.
export function binderName(g: number): string {
  const base = FIBER_COLORS[g % FIBER_COLOR_COUNT];
  const striped = g >= FIBER_COLOR_COUNT;
  return striped ? `${base.name}/Stripe` : base.name;
}

export type FiberCode = {
  position: number; // 1-based absolute fiber number within the cable
  binderIndex: number; // 0-based binder/tube group
  fiberIndex: number; // 0-based fiber within the binder
  binderColor: string; // binder group display name
  binderCode: string; // binder base color short code
  fiberColor: string; // fiber color display name
  fiberCode: string; // fiber color short code
};

// Resolve the color code for a single 1-based fiber position.
export function fiberCodeFor(position: number): FiberCode {
  const zero = position - 1;
  const binderIndex = Math.floor(zero / FIBER_COLOR_COUNT);
  const fiberIndex = zero % FIBER_COLOR_COUNT;
  const binderBase = FIBER_COLORS[binderIndex % FIBER_COLOR_COUNT];
  const fiber = FIBER_COLORS[fiberIndex];
  return {
    position,
    binderIndex,
    fiberIndex,
    binderColor: binderName(binderIndex),
    binderCode: binderBase.code,
    fiberColor: fiber.name,
    fiberCode: fiber.code,
  };
}

// Generate the full ordered list of fiber positions for a cable of `fiberCount`
// fibers. Used when a Cable is created to seed its FiberPosition rows.
export function generateFiberPositions(fiberCount: number): FiberCode[] {
  const out: FiberCode[] = [];
  for (let p = 1; p <= fiberCount; p++) out.push(fiberCodeFor(p));
  return out;
}

// Shape used to persist FiberPosition rows (matches the Prisma model).
export function fiberPositionRows(
  cableId: string,
  fiberCount: number
): { cableId: string; position: number; binderColor: string; fiberColor: string }[] {
  return generateFiberPositions(fiberCount).map((f) => ({
    cableId,
    position: f.position,
    binderColor: f.binderColor,
    fiberColor: f.fiberColor,
  }));
}
