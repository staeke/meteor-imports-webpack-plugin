var fs = require('fs');
var path = require('path');

function MeteorImportsPlugin(config) {
  config.exclude = [
    'autoupdate',
    'global-imports',
    'hot-code-push',
    'reload',
    'ecmascript',
  ].concat(config.exclude || []);
  this.config = config;
}

MeteorImportsPlugin.prototype.apply = function(compiler) {
  var self = this;

  // Create path for internal build of the meteor packages.
  self.meteorBuild = path.join(
    compiler.context, self.config.meteorFolder,
    '.meteor', 'local', 'build', 'programs', 'web.browser'
  );

  var stream = fs.createWriteStream(self.config.meteorFile);
  stream.once('open', function(fd) {

    stream.write("window.__meteor_runtime_config__ = require('meteor-config');\n\n");
    stream.write('if (module.hot)module.hot.accept("meteor-config", function(){});\n');

    var manifest = require(self.meteorBuild + '/program.json').manifest;

    // Create regexp to exclude the packages we don't want.
    var excluded = new RegExp(self.config.exclude
      .map(function(exclude){ return '^packages/' + exclude + '.js$'; })
      .concat('^app\/.+.js$')
      .join('|'));

    // Require the Meteor packages.
    manifest.forEach(function(pckge){
      if (!excluded.test(pckge.path)) {
        var packageName = pckge.path.replace('packages/', '');
        stream.write('require("meteor-packages/' + packageName + '");\n');
        stream.write('if (module.hot)module.hot.accept("' + packageName + '", function(){});\n');
      }
    });
    stream.end();
  });

  compiler.plugin("compile", function(params) {

    // Check if module loaders is defined.
    if (compiler.options.module.loaders === undefined)
      throw Error('Add an empty array in module.loaders of your webpack config.');

    // Check if Meteor has been run at least once.
    try {
      var manifest = require(self.meteorBuild + '/program.json').manifest;
    } catch (e) {
      throw Error('Run Meteor at least once.')
    }

    // Create an alias so we can do the context properly using the folder
    // variable from the meteor config file. If we inject the folder variable
    // directly in the request.context webpack goes wild.
    compiler.options.resolve.alias['meteor-build'] = self.meteorBuild;
    compiler.options.resolve.alias['meteor-packages'] = self.meteorBuild +
      '/packages';
    compiler.options.resolve.alias['meteor-config'] = path.join(
      __dirname, 'meteor-config.json');


    // Create an alias for the meteor-imports require.
    // compiler.options.resolve.alias['meteor-imports'] = path.join(
    //   __dirname, './meteor-imports.js');

    // Add a loader to inject the meteor config in the meteor-imports require.
    compiler.options.module.loaders.push({
      test: /meteor-config/,
      loader: 'json-string-loader?json=' + JSON.stringify(self.config)
    });

    // Add a loader to inject this as window in the meteor packages.
    compiler.options.module.loaders.push({
      test: new RegExp('.meteor/local/build/programs/web.browser/packages'),
      loader: 'imports?this=>window'
    });

    // Add a resolveLoader to use the loaders from this plugin's own NPM
    // dependencies.
    compiler.options.resolveLoader.modulesDirectories.push(
      path.join(__dirname, 'node_modules')
    );

    // Add Meteor packages like if they were NPM packages.
    compiler.options.resolve.modulesDirectories.push(
      path.join( self.meteorBuild, 'packages'));

    // Create an alias for each Meteor packages and a loader to extract its
    // globals.
    var excluded = new RegExp(self.config.exclude
      .map(function(exclude){ return '^packages/' + exclude + '\.js$'; })
      .concat('^app\/.+.js$')
      .join('|'));
    manifest.forEach(function(pckge){
      if (!excluded.test(pckge.path)) {
        var packageName = /^packages\/(.+)\.js$/.exec(pckge.path)[1];
        packageName = packageName.replace('_', ':');
        compiler.options.resolve.alias['meteor/' + packageName] =
          self.meteorBuild + '/' + pckge.path;
        compiler.options.module.loaders.push({
          test: new RegExp('.meteor/local/build/programs/web.browser/' + pckge.path),
          loader: 'exports?Package["' + packageName + '"]'
        })
      }
    });

  });

  // Don't create modules and chunks for excluded packages.
  compiler.plugin("normal-module-factory", function(nmf) {
    var excluded = new RegExp(self.config.exclude
      .map(function(exclude) { return '^\./' + exclude + '\.js$' })
      .join('|'));
		nmf.plugin("before-resolve", function(result, callback) {
			if(!result) return callback();
			if(excluded.test(result.request)){
				return callback();
			}
			return callback(null, result);
		});
	});
};

module.exports = MeteorImportsPlugin;
