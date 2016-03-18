try {
  var manifest = require('json!meteor-build/program.json').manifest;
  // manifest = JSON.stringify(configJson).manifest;
} catch(err) {
  console.error('Error: You have to run Meteor at least once.');
}

var config = require('./meteor-config.json');

__meteor_runtime_config__ = config;

var req = require.context(
  'imports?this=>window!exports?Package!meteor-build',
  true,
  /\.js$/
);

var excluded = new RegExp(config.EXCLUDE
  .map(function(exclude){ return 'packages/' + exclude + '.js'; }).join('|'));

manifest.forEach(function(package){
  if (!excluded.test(package.path))
    req('./' + package.path);
});

debugger;
