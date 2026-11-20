#!/usr/bin/env node
/**
 * Release helpers, used by .github/workflows/release.yml and `pnpm package`.
 *
 *   node scripts/release.mjs bump <auto|none|patch|minor|major>
 *       set the version in extension/manifest.json and package.json; print it.
 *       auto: release the current version if its tag vX.Y.Z does not exist
 *       yet (the first release, or a run that failed before tagging), else
 *       patch. Fails when the resulting tag exists (see alreadyReleased).
 *   node scripts/release.mjs package
 *       zip the contents of extension/ into dist/oshi-live-alert-v<version>.zip
 *       (manifest.json at the top, no dotfiles); print the path
 *   node scripts/release.mjs notes
 *       print $RELEASE_NOTES as Markdown (a typed "\n" becomes a new line,
 *       since the Actions "Run workflow" form has single-line inputs only)
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const BUMPS = ['none', 'patch', 'minor', 'major'];
const VERSION_FIELD = /^(\s*"version":\s*")([^"]*)(")/m;

/**
 * @param {string} version `x.y.z`
 * @param {string} bump none | patch | minor | major
 * @returns {string}
 */
export function bumpVersion(version, bump) {
  if (!BUMPS.includes(bump))
    throw new Error(`bump must be one of ${BUMPS.join(', ')}, not "${bump}"`);
  if (!/^\d+\.\d+\.\d+$/.test(version))
    throw new Error(`version must be x.y.z (numbers only), not "${version}"`);
  const [major, minor, patch] = version.split('.').map(Number);
  if (bump === 'major') return `${major + 1}.0.0`;
  if (bump === 'minor') return `${major}.${minor + 1}.0`;
  if (bump === 'patch') return `${major}.${minor}.${patch + 1}`;
  return version;
}

/**
 * Resolve `auto`: an untagged version is released as is (so a new run after
 * one that committed its bump but failed before tagging does not bump
 * again), a released one gets the next patch. A GitHub re-run is different:
 * it checks out the run's original commit (see alreadyReleased).
 *
 * @param {string} version
 * @param {string} bump auto | none | patch | minor | major
 * @param {(tag: string) => boolean} hasTag
 * @returns {string} none | patch | minor | major
 */
export function chooseBump(version, bump, hasTag) {
  if (bump !== 'auto') return bump;
  return hasTag(`v${version}`) ? 'patch' : 'none';
}

/**
 * Why a release stops when its tag exists, and the ways on. The usual case
 * is a re-run of a Release run whose store step failed: the re-run checks out
 * the run's original commit, so `auto` bumps to the version the first
 * attempt already released.
 *
 * @param {string} tag
 * @returns {string}
 */
export function alreadyReleased(tag) {
  return [
    `${tag} is already released.`,
    `If only its Chrome Web Store submission failed, retry just that: "Re-run failed jobs" on that Release run, or Actions → Store → submit with tag ${tag}.`,
    'Fix: to release new changes, choose a bump (patch, minor, major), or raise the version in extension/manifest.json.',
  ].join('\n');
}

/**
 * Replace the version field in JSON text, keeping the rest byte for byte
 * (re-serializing would undo Prettier's formatting).
 *
 * @param {string} text
 * @param {string} version
 * @returns {string}
 */
export function setVersion(text, version) {
  if (!VERSION_FIELD.test(text)) throw new Error('no "version" field found');
  return text.replace(VERSION_FIELD, `$1${version}$3`);
}

/** @param {string} text */
const readVersion = (text) =>
  /** @type {RegExpExecArray} */ (VERSION_FIELD.exec(text))[2];

/**
 * @param {string | undefined} input
 * @returns {string} Markdown, ending in a new line (empty when no notes)
 */
export function releaseNotes(input) {
  const body = (input ?? '').replaceAll('\\n', '\n').trim();
  return body ? `${body}\n` : '';
}

/**
 * @param {{ root: string, version: string, run: (cmd: string, args: string[], opts: object) => unknown }} options
 * @returns {string} the zip's path
 */
export function packageExtension({ root, version, run }) {
  const zip = path.join(root, 'dist', `oshi-live-alert-v${version}.zip`);
  // zip -r updates an existing archive in place (stale files would stay).
  fs.rmSync(zip, { force: true });
  run('zip', ['-q', '-r', '-X', zip, '.', '-x', '.*', '*/.*'], {
    cwd: path.join(root, 'extension'),
    stdio: 'inherit',
  });
  return zip;
}

/**
 * @param {string[]} argv
 * @param {{
 *   root: string,
 *   env: Record<string, string | undefined>,
 *   print: (s: string) => void,
 *   run?: (cmd: string, args: string[], opts: object) => unknown,
 *   hasTag?: (tag: string) => boolean,
 * }} io
 */
export function main(
  [command, arg],
  {
    root,
    env,
    print,
    run = execFileSync,
    hasTag = (tag) => {
      try {
        run('git', ['rev-parse', '-q', '--verify', `refs/tags/${tag}`], {
          cwd: root,
          stdio: 'ignore',
        });
        return true;
      } catch {
        return false;
      }
    },
  }
) {
  const manifestPath = path.join(root, 'extension', 'manifest.json');
  const manifest = () => fs.readFileSync(manifestPath, 'utf8');
  if (command === 'bump') {
    const pkgPath = path.join(root, 'package.json');
    const pkg = fs.readFileSync(pkgPath, 'utf8');
    const current = readVersion(manifest());
    if (readVersion(pkg) !== current)
      throw new Error(
        `extension/manifest.json (${current}) and package.json (${readVersion(pkg)}) disagree`
      );
    const next = bumpVersion(current, chooseBump(current, arg, hasTag));
    if (hasTag(`v${next}`)) throw new Error(alreadyReleased(`v${next}`));
    fs.writeFileSync(manifestPath, setVersion(manifest(), next));
    fs.writeFileSync(pkgPath, setVersion(pkg, next));
    print(next);
  } else if (command === 'package') {
    fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
    print(packageExtension({ root, version: readVersion(manifest()), run }));
  } else if (command === 'notes') {
    print(releaseNotes(env.RELEASE_NOTES));
  } else {
    throw new Error(
      'Usage: node scripts/release.mjs bump <auto|none|patch|minor|major> | package | notes'
    );
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2), {
      root: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
      env: process.env,
      print: (s) => process.stdout.write(s.endsWith('\n') ? s : `${s}\n`),
    });
  } catch (error) {
    const message = String(/** @type {Error} */ (error).message ?? error);
    console.error(message);
    if (!message.includes('Fix:'))
      console.error(
        'Fix: check the arguments above, or the version in extension/manifest.json'
      );
    process.exit(1);
  }
}
