debugger;

var manifest = require('json!meteor-build/program.json').manifest;
__meteor_runtime_config__ = config;

var req = require.context(
  'imports?this=>window!exports?Package!meteor-build',
  true,
  /\.js$/
);

var excluded = new RegExp(config.exclude
  .map(function(exclude){ return 'packages/' + exclude + '.js'; }).join('|'));

manifest.forEach(function(package){
  if (!excluded.test(package.path))
    req('./' + package.path);
});
