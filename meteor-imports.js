var manifest = require('json!meteor-build/program.json').manifest;
var config = require('./meteor-config.json');

__meteor_runtime_config__ = config;

// Create context to create a chunk for each Meteor package.
var req = require.context(
  'meteor-build', true, /\.js$/);

// Require the Meteor packages.
var excluded = new RegExp(config.EXCLUDE
  .map(function(exclude){ return 'packages/' + exclude + '.js'; }).join('|'));
manifest.forEach(function(package){
  if (!excluded.test(package.path))
    req('./' + package.path);
});
