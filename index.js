var fs = require('fs');
var path = require('path');

function MeteorImportsPlugin(config) {
  config.EXCLUDE = [
    'autoupdate',
    'global-imports',
    'hot-code-push',
    'reaload',
  ].concat(config.EXCLUDE || []);
  this.config = config;
}

MeteorImportsPlugin.prototype.apply = function(compiler) {
  var self = this;

  compiler.plugin("compile", function(params) {
    var meteorBuild = path.join(
      params.normalModuleFactory.context, self.config.METEOR_FOLDER,
      '.meteor', 'local', 'build', 'programs', 'web.browser'
    );

    if (compiler.options.module.loaders === undefined)
      throw Error('Add an empty array in module.loaders of your webpack config.');

    try {
      fs.accessSync(meteorBuild + '/program.json', fs.F_OK);
    } catch (e) {
      throw Error('Run your Meteor server at least once.')
    }

    // Create an alias so we can do the context properly using the folder
    // variable from the meteor config file. If we inject the folder variable
    // directly in the request.context webpack goes wild.
    compiler.options.resolve.alias['meteor-build'] = meteorBuild;

    // Create an alias for the meteor-init script.
    compiler.options.resolve.alias['meteor-imports'] = path.join(
      __dirname, './meteor-imports.js');

    // Add a loader to inject the meteor config in the meteor-init script.
    compiler.options.module.loaders.push({
      test: /meteor-config/,
      loader: 'json-string-loader?json=' + JSON.stringify(self.config)
    });

    // Add Meteor packages like if they were NPM packages.
    compiler.options.resolve.modulesDirectories.push(
      meteorBuild + '/packages');
  });

  // Don't create modules and chunks for excluded packages.
  compiler.plugin("normal-module-factory", function(nmf) {
		nmf.plugin("before-resolve", function(result, callback) {
			if(!result) return callback();
			if(new RegExp(self.config.EXCLUDE.join('|')).test(result.request)){
				return callback();
			}
			return callback(null, result);
		});
	});
};

module.exports = MeteorImportsPlugin;
