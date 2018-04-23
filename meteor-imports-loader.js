const _ = require('lodash');

module.exports = function (source) {
  let output = '';

  const config = this.query.config;
  const packages = this.query.packages;

  const clientConfig = _.omit(config, 'exclude', 'meteorFolder', 'packages', 'autoupdate', 'reload');
  const jsonConfig = JSON.stringify(clientConfig);

  if (config.injectMeteorRuntimeConfig !== false) {
    output += 'var config = window.__meteor_runtime_config__ || (window.__meteor_runtime_config__ = {});\n';
    output += `Object.assign(config, ${jsonConfig});\n`;
  }

  if (!config.DDP_DEFAULT_CONNECTION_URL) {
    const port = config.DDP_DEFAULT_CONNECTION_PORT || 3000;
    output += 'config.DDP_DEFAULT_CONNECTION_URL = window.location.protocol + "\//" + window.location.hostname + ":" + "' + port + '";\n';
  }
  if (!config.ROOT_URL) {
    output += 'config.ROOT_URL = window.location.protocol + "\//" + window.location.host;\n';
  }

  // Require all packages
  for (let pkg of packages) {
    if (pkg.source)
      output += 'window.Package["' + pkg.name + '"] = ' + pkg.source + ';\n';
    else
      output += 'require("meteor/' + pkg.name + '");\n';
  }

  return output;
};
