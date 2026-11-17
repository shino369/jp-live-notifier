/**
 * Offscreen document: service workers have no DOMParser, so the service worker
 * sends fetched HTML here and gets listings back.
 */
import { localParse } from './lib/job.js';
import { adapterById } from './sites/index.js';

const parse = localParse(new DOMParser());

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== 'offscreen' || msg.type !== 'parse') return false;
  const adapter = adapterById(msg.site);
  if (!adapter) {
    sendResponse({ error: `unknown site ${msg.site}` });
    return false;
  }
  parse(adapter, msg.text, { ...msg.ctx, now: new Date(msg.ctx.now) }).then(
    (listings) => sendResponse({ listings }),
    (error) => sendResponse({ error: String(error?.message ?? error) })
  );
  return true;
});
