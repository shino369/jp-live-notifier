/**
 * Site adapter registry.
 */
import { siteEnabled } from '../lib/settings.js';
import asobi from './asobi.js';
import eplus from './eplus.js';
import livepocket from './livepocket.js';
import ltike from './ltike.js';
import pia from './pia.js';
import rakuten from './rakuten.js';
import zaiko from './zaiko.js';
import zanlive from './zanlive.js';

/** @type {import('../lib/job.js').Adapter[]} */
export const ADAPTERS = [
  eplus,
  ltike,
  pia,
  rakuten,
  livepocket,
  asobi,
  zanlive,
  zaiko,
];

/** @type {Record<string, string>} */
export const SITE_NAMES = Object.fromEntries(
  ADAPTERS.map((a) => [a.id, a.name])
);

/**
 * Whether the user has this site on (opt-in sites start off).
 *
 * @param {import('../lib/settings.js').Settings} settings
 * @param {import('../lib/job.js').Adapter} adapter
 */
export const adapterOn = (settings, adapter) =>
  siteEnabled(settings, adapter.id, !adapter.optIn);

/** @param {string} id */
export const adapterById = (id) => ADAPTERS.find((a) => a.id === id);
