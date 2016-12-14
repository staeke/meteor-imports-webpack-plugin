/* eslint-env node */

var path = require('path');

function escapeForRegEx(str) {
  return str.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&');
}

function strToRegex(str) {
  return new RegExp(escapeForRegEx(str));
}

var PATH_SEP_REGEX = '[/\\\\]';

// Join an array with environment agnostic path identifiers
function arrToPathForRegEx(arr) {
  return arr.map(function(x) {
    return escapeForRegEx(x)
  }).join(PATH_SEP_REGEX);
}

var BUILD_PATH_PARTS = ['.meteor', 'local', 'build', 'programs', 'web.browser'];
var PACKAGES_PATH_PARTS = BUILD_PATH_PARTS.concat(['packages']);
var PACKAGES_REGEX = new RegExp(arrToPathForRegEx(PACKAGES_PATH_PARTS));
var PACKAGES_REGEX_NOT_MODULES = new RegExp(
  arrToPathForRegEx(PACKAGES_PATH_PARTS) +
  PATH_SEP_REGEX +
  '(?!modules\.js)[^/\\\\]+$'
);

function MeteorImportsPlugin(config) {
  config.exclude = [
    'autoupdate',
    'ecmascript',
    'hot-code-push',
    'livedata',
    'reload'
  ].concat(config.exclude || []);
  this.config = config;
}

MeteorImportsPlugin.prototype.apply = function(compiler) {
  var self = this;

  compiler.plugin("compile", function(params) {
    // clear loaders from previous compile
    for (var i = compiler.options.module.loaders.length - 1; i--;) {
      if (compiler.options.module.loaders[i].meteorImports) {
        compiler.options.module.loaders.splice(i, 1);
      }
    }

    // Create path for internal build of the meteor packages.
    var meteorBuild = self.config.meteorProgramsFolder
      ? path.resolve(params.normalModuleFactory.context, self.config.meteorProgramsFolder, 'web.browser')
      : path.resolve.apply(path, [
      params.normalModuleFactory.context,
      self.config.meteorFolder
    ].concat(BUILD_PATH_PARTS));

    // Create path for plugin node modules directory.
    var meteorNodeModules = path.join(__dirname, 'node_modules');

    // Create path for meteor app packages directory.
    var meteorPackages = path.join(meteorBuild, 'packages');

    // Check if module loaders is defined.
    if (compiler.options.module.loaders === undefined)
      throw Error('Add an empty array in module.loaders of your webpack config.');

    // Check if Meteor has been run at least once.
    try {
      var manifest = require(meteorBuild + '/program.json').manifest;
    } catch (e) {
      throw Error('Run Meteor at least once and wait for startup to complete.')
    }

    // Create an alias so we can do the context properly using the folder
    // variable from the meteor config file. If we inject the folder variable
    // directly in the request.context webpack goes wild.
    compiler.options.resolve.alias['meteor-build'] = meteorBuild;
    compiler.options.resolve.alias['meteor-packages'] = meteorPackages;

    // Create an alias for the meteor-imports require.
    compiler.options.resolve.alias['meteor-imports'] = path.join(
      __dirname, './meteor-imports.js');

    // Add a loader to inject the meteor config in the meteor-imports require.
    compiler.options.module.loaders.push({
      meteorImports: true,
      test: /meteor-config/,
      loader: 'json-string-loader?json=' + JSON.stringify(self.config)
    });

    var meteorPkgsRel = PACKAGES_PATH_PARTS.join('/');
    // Add a loader to inject this as window in the meteor packages.
    compiler.options.module.loaders.push({
      meteorImports: true,
      test: new RegExp(escapeForRegEx(meteorPkgsRel) + '.*\\.js'),
      loader: 'imports?this=>window'
    });

    compiler.options.module.loaders.push({
      meteorImports: true,
      test: strToRegex(path.join(meteorPkgsRel, '/modules.js')),
      loader: path.join(__dirname, 'modules-loader.js')
    });

    compiler.options.module.loaders.push({
      meteorImports: true,
      test: strToRegex(meteorPkgsRel + '/global-imports.js'),
      loader: path.join(__dirname, 'global-imports-loader.js'),
      query: self.config
    });

    // Add a resolveLoader to use the loaders from this plugin's own NPM
    // dependencies.
    if (compiler.options.resolveLoader.modulesDirectories.indexOf(meteorNodeModules) < 0) {
      compiler.options.resolveLoader.modulesDirectories.push(meteorNodeModules);
    }

    // Add Meteor packages like if they were NPM packages.
    if (compiler.options.resolve.modulesDirectories.indexOf(meteorPackages) < 0) {
      compiler.options.resolve.modulesDirectories.push(meteorPackages);
    }

    // Create an alias for each Meteor packages and a loader to extract its
    // globals.
    var excluded = new RegExp(self.config.exclude
      .map(function(exclude){ return '^packages/' + exclude + '\.js$'; })
      .concat('^app\/.+.js$')
      .join('|'));
    manifest.forEach(function(pckge){
      if (excluded.test(pckge.path)) {
        return;
      }
      var location = /^packages\/(.+)\.js$/.exec(pckge.path);

      if (!location) {
        return;
      }

      var packageName = location[1];
      packageName = packageName.replace('_', ':');
      compiler.options.resolve.alias['meteor/' + packageName] =
        meteorBuild + '/' + pckge.path;
      compiler.options.module.loaders.push({
        meteorImports: true,
        test: new RegExp('.meteor/local/build/programs/web.browser/' + pckge.path),
        loader: 'exports?Package["' + packageName + '"]'
      })
    });

  });

  // Don't create modules and chunks for excluded packages.
  compiler.plugin("normal-module-factory", function(nmf) {
    var excluded = new RegExp(self.config.exclude
      .map(function(exclude) { return '^\./' + exclude + '\.js$' })
      .join('|'));
    nmf.plugin("before-resolve", function(result, callback) {
      if (!result) return callback();
      if (excluded.test(result.request)) {
        return callback();
      }
      return callback(null, result);
    });

    nmf.plugin("after-resolve", function(result, callback) {
      // We want to parse modules.js, but that's the only one as the rest relies on internal Meteor require system

      if (result && result.request.match(PACKAGES_REGEX_NOT_MODULES)) {
        result.parser = {
          parse: function() {
          }
        };
      }
      return callback(null, result);
    });
  });
};

module.exports = MeteorImportsPlugin;
