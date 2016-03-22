var manifest = require('json!meteor-build/program.json').manifest;
var config = require('./meteor-config.json');

__meteor_runtime_config__ = config;

// Create context to create a chunk for each Meteor package.
var context = require.context('meteor-packages', false, /\.js$/);

// Create regexp to exclude the packages we don't want.
var excluded = new RegExp(config.exclude
  .map(function(exclude){ return '^packages/' + exclude + '.js$'; })
  .concat('^app\/.+.js$')
  .join('|'));

// Require the Meteor packages.
manifest.forEach(function(pckge){
  if (!excluded.test(pckge.path))
    context('./' + pckge.path.replace('packages/', ''));
});
