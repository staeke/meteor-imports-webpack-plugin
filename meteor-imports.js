const manifest = require('meteor-build/program.json').manifest;
const config = require('./meteor-config');

if (config.injectMeteorRuntimeConfig !== false) window.__meteor_runtime_config__ = config;

if (!config.DDP_DEFAULT_CONNECTION_URL) {
  const port = config.DDP_DEFAULT_CONNECTION_PORT || 3000;
  config.DDP_DEFAULT_CONNECTION_URL = window.location.protocol + '//' + window.location.hostname + ':' + port;
}

// Create context to create a chunk for each Meteor package.
const req = require.context('meteor-packages', true, /\.(js|css)$/);

// Create regexp to exclude the packages we don't want.
const excluded = new RegExp(config.exclude
  .map(function(exclude){ return '^packages/' + exclude + '.js$'; })
  .concat('^app\/app.*\.js$')
  .concat('\\/global-imports\\.js$')
  .join('|'));

// Require the Meteor packages.
manifest.forEach(function(pckge){
  if (!excluded.test(pckge.path) && pckge.type !== 'asset')
    req('./' + pckge.path.replace('packages/', ''));
});

if (config.globalImports) {
  require('meteor/global-imports');
}

if (module.hot) module.hot.accept();
