#!/usr/bin/env node
/**
 * Print a fresh 32-byte key for BIOCBOT_DATA_ENCRYPTION_KEY.
 *
 * Run once per environment. The key is printed and never written anywhere — put
 * it straight into that environment's secret store.
 *
 *   node scripts/generate-encryption-key.js
 */

const crypto = require('node:crypto');

const key = crypto.randomBytes(32).toString('base64');

console.log('');
console.log('BIOCBOT_DATA_ENCRYPTION_KEY=' + key);
console.log('');
console.log('Store this in the secret store for ONE environment, separately from');
console.log('the MongoDB credentials and outside every database backup.');
console.log('If it is lost, the fields encrypted under it cannot be recovered.');
console.log('');
