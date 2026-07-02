import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';

const SRC = path.resolve(process.cwd(), 'src');

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
  });
}

describe('regression guards', () => {
  // D — anti-regression: no NEW pretty-printed JSON in machine response payloads. The compact-JSON
  // default is the biggest token win; this locks it. Legitimate pretty sites are allowlisted:
  //   - dto-fallback ternaries (`typeof x === 'string' ? x : JSON.stringify(x, null, 2)`) — dto is an
  //     explicit debug request;
  //   - human-facing previews that interpolate JSON into prose (`${JSON.stringify(payload, null, 2)}`);
  //   - stderr debug logging (console.error / debugLog).
  it('no pretty-printed JSON in machine response payloads (allowlisted debug/dto/human sites only)', () => {
    const offenders: string[] = [];
    for (const f of walk(SRC)) {
      // formatter.ts is the format-vocabulary home: `format:'json'` (+ its human string fallback)
      // are deliberate pretty modes, opt-in only. Everything else must default to compact.
      if (f.endsWith(path.join('utils', 'formatter.ts'))) continue;
      fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        if (!/,\s*null,\s*2\s*\)/.test(line)) return;
        const allowed =
          /typeof /.test(line) || // dto-fallback ternary
          /\$\{/.test(line) || // interpolated into human-facing prose
          /console\.error/.test(line) ||
          /debugLog/.test(line);
        if (!allowed) offenders.push(`${path.relative(SRC, f)}:${i + 1}`);
      });
    }
    assert.deepEqual(offenders, [], `pretty JSON in machine payload: ${offenders.join(', ')}`);
  });
});
