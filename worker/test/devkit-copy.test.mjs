// claims.js and custom-token.js are app-devkit's files, copied with their version line. CI compares them with the
// pinned devkit's copies (.devkit/worker/, from setup-tools); locally this test is skipped without .devkit/.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const here = f => new URL('../' + f, import.meta.url);
const kit = f => new URL('../../.devkit/worker/' + f, import.meta.url);

for (const f of ['claims.js', 'custom-token.js']) {
  test(`${f} keeps its app-devkit version line`, () => {
    assert.match(fs.readFileSync(here(f), 'utf8').split('\n')[0], new RegExp(`^// app-devkit worker/${f.replace('.', '\\.')} \\d+\\.\\d+\\.\\d+\\.`));
  });
  test(`${f} is unchanged from the pinned app-devkit`, { skip: !fs.existsSync(kit(f)) && 'no .devkit/ here' }, () => {
    assert.equal(fs.readFileSync(here(f), 'utf8'), fs.readFileSync(kit(f), 'utf8'));
  });
}
