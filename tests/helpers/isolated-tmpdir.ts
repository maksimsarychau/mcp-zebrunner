/**
 * Point os.tmpdir() at a fresh folder for the enclosing describe() only.
 * Unit tests share one process (--experimental-test-isolation=none), so the hooks must be
 * describe-scoped and restore whatever TMPDIR was set before them.
 */
import { before, after, beforeEach, afterEach } from "node:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REAL_TMP = tmpdir();

export function isolateTmpdir(prefix: string, opts: { perTest?: boolean } = {}): () => string {
  let dir = "";
  let previous: string | undefined;
  const setup = () => {
    previous = process.env.TMPDIR;
    dir = realpathSync(mkdtempSync(join(REAL_TMP, prefix)));
    process.env.TMPDIR = dir;
  };
  const teardown = () => {
    if (previous === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = previous;
    rmSync(dir, { recursive: true, force: true });
  };
  if (opts.perTest) {
    beforeEach(setup);
    afterEach(teardown);
  } else {
    before(setup);
    after(teardown);
  }
  return () => dir;
}
