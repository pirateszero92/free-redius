/**
 * Shared MAC address utilities.
 * Centralised here to avoid duplication between devices.js and acl.js.
 */

/**
 * Normalise a MAC address to aa:bb:cc:dd:ee:ff format.
 * Returns empty string if the input is falsy or contains fewer than 12 hex chars.
 */
function normalizeMac(mac) {
  if (!mac) return '';
  const clean = mac.toLowerCase().replace(/[^0-9a-f]/g, '');
  if (clean.length !== 12) return '';
  return clean.match(/.{1,2}/g).join(':');
}

/**
 * Validate and normalise a MAC address, throwing an Error on invalid input.
 * Used by device registration where bad input should surface as a 400 response.
 */
function normalizeMacStrict(mac) {
  const result = normalizeMac(mac);
  if (!result) throw new Error('Invalid MAC address. Must be 12 hex characters.');
  return result;
}

/**
 * Generate 6 common MAC formats for maximum compatibility with all APs/Switches.
 * Format: aabbccddeeff, aa:bb:cc:dd:ee:ff, aa-bb-cc-dd-ee-ff (lower + upper each)
 */
function getMacFormats(mac) {
  const clean = mac.replace(/[^0-9a-fA-F]/g, '').toLowerCase();
  const f1 = clean;
  const f2 = clean.match(/.{1,2}/g).join(':');
  const f3 = clean.match(/.{1,2}/g).join('-');
  return [
    f1, f2, f3,
    f1.toUpperCase(), f2.toUpperCase(), f3.toUpperCase()
  ];
}

module.exports = { normalizeMac, normalizeMacStrict, getMacFormats };
