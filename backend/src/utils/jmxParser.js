/**
 * jmxParser.js — Lightweight JMX thread group extractor
 *
 * Parses a JMeter (.jmx) file and extracts per-thread-group metadata:
 *   name, slug, default threads / rampUp / duration / thinkTime
 *
 * No external XML library required — uses string scanning + regex.
 * Handles:
 *   - Multi-line ThreadGroup opening tags
 *   - Disabled thread groups (skipped)
 *   - JMeter property refs: ${__P(prop_name,default)}  → extracts default
 *   - JMeter UDV refs:      ${VARNAME}                → uses sensible fallback
 *   - Plain integer literals
 *   - Duplicate thread group names → de-duplicated slugs
 */
'use strict';

/**
 * Slugify a thread group name for use as a JMeter property prefix.
 *
 * Examples:
 *   "Browse Users"  → "browse_users"
 *   "Checkout!"     → "checkout"
 *   "Thread Group"  → "thread_group"
 */
function slugifyGroup(name) {
  return (name || 'thread_group')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32) || 'thread_group';
}

/**
 * Extract a numeric default from a raw stringProp value.
 *
 * "${__P(browse_users,5)}"  → 5      (JMeter property default)
 * "${THREADS}"              → fallback (unresolvable variable)
 * "10"                      → 10     (plain literal)
 */
function extractPropDefault(value, fallback) {
  if (!value) return fallback;
  const v = value.trim();

  // ${__P(anyName, NUMBER)} — use the declared default
  const propMatch = v.match(/\$\{__P\([^,)]+,\s*(\d+)\s*\)\}/);
  if (propMatch) return parseInt(propMatch[1], 10);

  // ${VARIABLE} or ${__func()} — cannot resolve statically
  if (v.startsWith('${')) return fallback;

  // Plain integer
  const n = parseInt(v, 10);
  return isNaN(n) ? fallback : n;
}

/**
 * Find the value of <stringProp name="propName">VALUE</stringProp>
 * inside a ThreadGroup body fragment, then extract its numeric default.
 *
 * @param {string} body      - XML text between <ThreadGroup>…</ThreadGroup>
 * @param {string} propName  - e.g. "ThreadGroup.num_threads"
 * @param {number} fallback  - returned when the property is absent / non-numeric
 */
function extractBodyProp(body, propName, fallback) {
  const escapedName = propName.replace(/\./g, '\\.');
  const re = new RegExp(
    `<stringProp[^>]+name="${escapedName}"[^>]*>([^<]*)<\\/stringProp>`,
  );
  const m = body.match(re);
  return extractPropDefault(m ? m[1] : null, fallback);
}

/**
 * Parse all *enabled* ThreadGroup elements from a JMX file.
 *
 * The returned `slug` is the JMeter property prefix the frontend uses to
 * build per-group run parameters, e.g.:
 *
 *   slug = "browse"
 *   → JMeter flags: -Jbrowse_users=N  -Jbrowse_rampup=N
 *                   -Jbrowse_duration=N  -Jbrowse_thinktime=N
 *
 * The JMX file must use matching ${__P(browse_users,DEFAULT)} expressions in
 * the ThreadGroup properties so JMeter picks them up.
 *
 * @param {string} jmxContent  - Raw UTF-8 JMX file content
 * @returns {Array<{
 *   name:      string,   // ThreadGroup testname attribute
 *   slug:      string,   // slugified property prefix
 *   threads:   number,   // default virtual user count
 *   rampUp:    number,   // default ramp-up in seconds
 *   duration:  number,   // default duration in seconds
 *   thinkTime: number,   // default think time in ms (500 if undetectable)
 * }>}
 */
function parseThreadGroups(jmxContent) {
  const groups  = [];
  const slugMap = new Map(); // slug → count, for de-duplication
  let pos = 0;

  while (pos < jmxContent.length) {
    // ── Locate next <ThreadGroup … > opening ──────────────────────────────
    const tgStart = jmxContent.indexOf('<ThreadGroup', pos);
    if (tgStart === -1) break;

    // Opening tag may span multiple lines (attributes can be long)
    const openTagEnd = jmxContent.indexOf('>', tgStart);
    if (openTagEnd === -1) break;

    const openTag = jmxContent.slice(tgStart, openTagEnd + 1);

    // Skip explicitly disabled groups
    const enabledMatch = openTag.match(/enabled="(true|false)"/);
    if (enabledMatch && enabledMatch[1] === 'false') {
      pos = openTagEnd + 1;
      continue;
    }

    // Extract thread group name
    const nameMatch = openTag.match(/testname="([^"]+)"/);
    const name = nameMatch ? nameMatch[1] : 'Thread Group';

    // ── Locate matching </ThreadGroup> ────────────────────────────────────
    const closeMarker = '</ThreadGroup>';
    const tgEnd = jmxContent.indexOf(closeMarker, openTagEnd);
    if (tgEnd === -1) break;

    const body = jmxContent.slice(openTagEnd + 1, tgEnd);

    // ── Extract load parameters ───────────────────────────────────────────
    const threads  = extractBodyProp(body, 'ThreadGroup.num_threads', 10);
    const rampUp   = extractBodyProp(body, 'ThreadGroup.ramp_time',   60);
    const duration = extractBodyProp(body, 'ThreadGroup.duration',    300);

    // Think time: look for a ConstantTimer / UniformRandomTimer delay value.
    // We inspect the *hashTree sibling* section that follows the ThreadGroup.
    // If no timer found, default to 500 ms.
    const afterGroupEnd = tgEnd + closeMarker.length;
    // Find the hashTree block immediately following this ThreadGroup
    const htStart = jmxContent.indexOf('<hashTree', afterGroupEnd);
    const htEnd   = jmxContent.indexOf('</hashTree>', htStart !== -1 ? htStart : afterGroupEnd);
    let thinkTime = 500;
    if (htStart !== -1 && htEnd !== -1 && htStart < afterGroupEnd + 200) {
      const htBody = jmxContent.slice(htStart, htEnd);
      const timerMatch = htBody.match(/<stringProp name="ConstantTimer\.delay">([^<]+)<\/stringProp>/);
      if (timerMatch) {
        thinkTime = extractPropDefault(timerMatch[1], 500);
      }
    }

    // ── De-duplicate slug ─────────────────────────────────────────────────
    let slug = slugifyGroup(name);
    const count = slugMap.get(slug) || 0;
    slugMap.set(slug, count + 1);
    if (count > 0) slug = `${slug}_${count + 1}`;

    groups.push({ name, slug, threads, rampUp, duration, thinkTime });

    pos = tgEnd + closeMarker.length;
  }

  return groups;
}

module.exports = { parseThreadGroups, slugifyGroup };
