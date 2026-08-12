const base = require('./playwright.config');

module.exports = {
  ...base,
  use: {
    ...(base.use || {}),
    video: 'on',
    screenshot: 'off',
    trace: 'off',
  },
};
