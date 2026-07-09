'use strict';

const { execSync } = require('child_process');
const path = require('path');

function resolveProjectRoot() {
  try {
    return execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
  } catch {
    return path.resolve(__dirname, '../../../..');
  }
}

module.exports = { resolveProjectRoot };
