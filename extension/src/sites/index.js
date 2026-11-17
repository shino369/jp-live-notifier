/**
 * Site adapter registry.
 */
import asobi from './asobi.js';
import eplus from './eplus.js';
import livepocket from './livepocket.js';
import ltike from './ltike.js';
import pia from './pia.js';
import rakuten from './rakuten.js';

/** @type {import('../lib/job.js').Adapter[]} */
export const ADAPTERS = [eplus, ltike, pia, rakuten, livepocket, asobi];

/** @type {Record<string, string>} */
export const SITE_NAMES = Object.fromEntries(
  ADAPTERS.map((a) => [a.id, a.name])
);

/** @param {string} id */
export const adapterById = (id) => ADAPTERS.find((a) => a.id === id);
