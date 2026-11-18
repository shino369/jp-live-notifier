import { vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  bumpVersion,
  chooseBump,
  main,
  packageExtension,
  releaseNotes,
  setVersion,
} from '../scripts/release.mjs';

describe('release', () => {
  test('bumpVersion raises the chosen part and resets the lower ones', () => {
    expect(bumpVersion('0.1.0', 'none')).toBe('0.1.0');
    expect(bumpVersion('0.1.0', 'patch')).toBe('0.1.1');
    expect(bumpVersion('0.1.9', 'minor')).toBe('0.2.0');
    expect(bumpVersion('1.4.2', 'major')).toBe('2.0.0');
    expect(() => bumpVersion('0.1.0', 'huge')).toThrow(/bump/);
    // Chrome versions are 1–4 dot-separated integers; releases use three.
    expect(() => bumpVersion('0.1', 'patch')).toThrow(/x\.y\.z/);
    expect(() => bumpVersion('0.1.0-beta', 'patch')).toThrow(/x\.y\.z/);
  });

  test('chooseBump: auto releases an untagged version as is, else bumps the patch', () => {
    const tags = new Set(['v0.1.0']);
    const hasTag = (/** @type {string} */ t) => tags.has(t);
    expect(chooseBump('0.1.0', 'auto', hasTag)).toBe('patch');
    expect(chooseBump('0.1.1', 'auto', hasTag)).toBe('none');
    expect(chooseBump('0.1.0', 'minor', hasTag)).toBe('minor');
  });

  test('setVersion rewrites only the top-level version field', () => {
    const manifest =
      '{\n  "manifest_version": 3,\n  "version": "0.1.0",\n  "icons": { "16": "a.png" }\n}\n';
    expect(setVersion(manifest, '0.1.1')).toBe(
      manifest.replace('"0.1.0"', '"0.1.1"')
    );
    expect(() => setVersion('{ "name": "x" }', '1.0.0')).toThrow(/version/);
  });

  test('releaseNotes turns typed \\n into new lines and trims', () => {
    expect(releaseNotes('  First release.\\n\\n- one\\n- two  ')).toBe(
      'First release.\n\n- one\n- two\n'
    );
    expect(releaseNotes(undefined)).toBe('');
    expect(releaseNotes('   ')).toBe('');
  });

  test('packageExtension zips the contents of extension/ without dotfiles', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'release-'));
    const stale = path.join(root, 'dist', 'oshi-live-alert-v0.1.1.zip');
    fs.mkdirSync(path.dirname(stale));
    fs.writeFileSync(stale, 'old archive');
    // zip updates an existing archive in place: the old one must be gone first.
    const run = vi.fn(() => expect(fs.existsSync(stale)).toBe(false));
    const zip = packageExtension({ root, version: '0.1.1', run });
    expect(zip).toBe(path.join(root, 'dist', 'oshi-live-alert-v0.1.1.zip'));
    expect(run).toHaveBeenCalledWith(
      'zip',
      ['-q', '-r', '-X', zip, '.', '-x', '.*', '*/.*'],
      { cwd: path.join(root, 'extension'), stdio: 'inherit' }
    );
  });

  test('main: bump writes both files and prints the version', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'release-'));
    fs.mkdirSync(path.join(root, 'extension'));
    fs.writeFileSync(
      path.join(root, 'extension', 'manifest.json'),
      '{\n  "version": "0.1.0"\n}\n'
    );
    fs.writeFileSync(
      path.join(root, 'package.json'),
      '{\n  "name": "x",\n  "version": "0.1.0"\n}\n'
    );
    /** @type {string[]} */
    const out = [];
    const io = {
      root,
      env: {},
      print: (/** @type {string} */ s) => out.push(s),
    };

    // auto: 0.1.0 has no tag yet, so it is released as is (files unchanged).
    main(['bump', 'auto'], { ...io, hasTag: () => false });
    expect(out).toEqual(['0.1.0']);
    out.length = 0;

    // The default tag lookup asks git: a failing lookup means no tag.
    const git = vi.fn(() => {
      throw new Error('no such ref');
    });
    main(['bump', 'auto'], { ...io, run: git });
    expect(out).toEqual(['0.1.0']);
    expect(git).toHaveBeenCalledWith(
      'git',
      ['rev-parse', '-q', '--verify', 'refs/tags/v0.1.0'],
      { cwd: root, stdio: 'ignore' }
    );
    out.length = 0;
    main(['bump', 'auto'], { ...io, run: vi.fn() });
    expect(out).toEqual(['0.1.1']);
    out.length = 0;

    main(['bump', 'minor'], io);
    expect(out).toEqual(['0.2.0']);
    expect(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).toContain(
      '"version": "0.2.0"'
    );
    expect(
      fs.readFileSync(path.join(root, 'extension', 'manifest.json'), 'utf8')
    ).toBe('{\n  "version": "0.2.0"\n}\n');

    // The two files disagree: refuse rather than guess.
    fs.writeFileSync(
      path.join(root, 'package.json'),
      '{\n  "version": "9.9.9"\n}\n'
    );
    expect(() => main(['bump', 'patch'], io)).toThrow(/disagree/);
  });

  test('main: notes prints the body; package prints the zip path; unknown command throws', () => {
    /** @type {string[]} */
    const out = [];
    const run = vi.fn();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'release-'));
    fs.mkdirSync(path.join(root, 'extension'));
    fs.writeFileSync(
      path.join(root, 'extension', 'manifest.json'),
      '{\n  "version": "0.3.0"\n}\n'
    );
    const io = {
      root,
      env: { RELEASE_NOTES: 'Hello\\nworld' },
      print: (/** @type {string} */ s) => out.push(s),
      run,
    };
    main(['notes'], io);
    main(['package'], io);
    expect(out).toEqual([
      'Hello\nworld\n',
      path.join(root, 'dist', 'oshi-live-alert-v0.3.0.zip'),
    ]);
    expect(fs.existsSync(path.join(root, 'dist'))).toBe(true);
    expect(() => main(['nope'], io)).toThrow(/Usage/);
  });
});
