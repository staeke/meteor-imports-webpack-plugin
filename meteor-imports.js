var manifest = require('meteor-build/program.json').manifest;
var config = require('./meteor-config');

if (config.injectMeteorRuntimeConfig !== false) window.__meteor_runtime_config__ = config;

// Create context to create a chunk for each Meteor package.
var req = require.context('meteor-packages', true, /\.(js|css)$/);

// Create regexp to exclude the packages we don't want.
var excluded = new RegExp(config.exclude
  .map(function(exclude){ return '^packages/' + exclude + '.js$'; })
  .concat('^app\/.+.js$')
  .join('|'));

// Require the Meteor packages.
manifest.forEach(function(pckge){
  if (!excluded.test(pckge.path) && pckge.type !== 'asset')
    req('./' + pckge.path.replace('packages/', ''));
});

if (module.hot) module.hot.accept();
