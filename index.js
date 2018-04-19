const path = require('path');
const webpack = require('webpack');
const RuleSet = require('webpack/lib/RuleSet');
const AliasPlugin = require('enhanced-resolve/lib/AliasPlugin');
const ModulesInRootPlugin = require('enhanced-resolve/lib/ModulesInRootPlugin');

function escapeForRegEx(str) {
  return str.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&');
}

// Join an array with environment agnostic path identifiers
function arrToPathForRegEx(arr) {
  return arr.map(function(x) {
    return escapeForRegEx(x)
  }).join('/');
}

const BUILD_PATH_PARTS = ['.meteor', 'local', 'build', 'programs', 'web.browser'];
const PACKAGES_PATH_PARTS = BUILD_PATH_PARTS.concat(['packages']);
const PACKAGES_REGEX = new RegExp(arrToPathForRegEx(PACKAGES_PATH_PARTS));
const PACKAGES_REGEX_NOT_MODULES = new RegExp(
  arrToPathForRegEx(PACKAGES_PATH_PARTS) +
  '\\/(?!modules\\.js)[^/\\\\]+$'
);
const PACKAGES_REGEX_MODULES = new RegExp(
  arrToPathForRegEx(PACKAGES_PATH_PARTS) +
  '\\/modules\\.js$'
);
const PACKAGES_REGEX_GLOBAL_IMPORTS = /\/global-imports\.js$/;




class MeteorImportsPlugin {
  constructor(config) {
    config.exclude = [
      'autoupdate',
      'hot-code-push',
      'livedate',
      'ecmascript',
    ].concat(config.exclude || []);
    this.config = config;
  }

  apply(compiler) {
    const self = this;

    function getMeteorBuild(context) {
      return self.config.meteorProgramsFolder
        ? path.resolve(context, self.config.meteorProgramsFolder, 'web.browser')
        : path.resolve.apply(path, [context, self.config.meteorFolder].concat(BUILD_PATH_PARTS));
    }

    function getManifest(context) {
      // Check if Meteor has been run at least once.
      try {
        return require(getMeteorBuild(context) + '/program.json').manifest;
      } catch (e) {
        throw Error('Run Meteor at least once and wait for startup to complete.')
      }
    }

    compiler.plugin("compile", function(params) {
      // Create path for internal build of the meteor packages.
      const meteorBuild = getMeteorBuild(params.normalModuleFactory.context);

      // Create path for plugin node modules directory.
      const meteorNodeModules = path.join(__dirname, 'node_modules');

      // Create path for meteor app packages directory.
      const meteorPackages = path.join(meteorBuild, 'packages');

      const manifest = getManifest(params.normalModuleFactory.context);

      // Create an alias so we can do the context properly using the folder
      // variable from the meteor config file. If we inject the folder variable
      // directly in the request.context webpack goes wild.
      compiler.resolvers.normal.apply(new AliasPlugin('described-resolve', {
        name: 'meteor-build',
        alias: meteorBuild,
      }, 'resolve'));
      compiler.resolvers.context.apply(new AliasPlugin('described-resolve', {
        name: 'meteor-packages',
        alias: meteorPackages,
        onlyModule: false,
      }, 'resolve'));

      // Create an alias for the meteor-imports require.
      compiler.resolvers.normal.apply(new AliasPlugin('described-resolve', {
        name: 'meteor-imports',
        alias: path.join(__dirname, './meteor-imports.js'),
      }, 'resolve'));

      compiler.resolvers.loader.apply(new ModulesInRootPlugin('module', meteorNodeModules, 'resolve'));

      // Create an alias for each Meteor packages and a loader to extract its
      // globals.
      const excluded = new RegExp(self.config.exclude
        .map(function(exclude){ return '^packages/' + exclude + '\.js$'; })
        .concat('^app\/app.*\.js$')
        .join('|'));

      manifest.forEach(function(pckge){
        if (!excluded.test(pckge.path)) {
          const match = /^(packages|app)\/(.+)\.js$/.exec(pckge.path);
          if (!match) return;
          let packageName = match[2];
          packageName = packageName.replace('_', ':');
          compiler.resolvers.normal.apply(new AliasPlugin('described-resolve', {
            name: 'meteor/' + packageName,
            alias: path.join(meteorBuild, pckge.path),
          }, 'resolve'));
        }
      });
    });

    // Don't create modules and chunks for excluded packages.
    compiler.plugin("normal-module-factory", function (nmf) {
      const excluded = new RegExp(self.config.exclude
        .map(function (exclude) { return '^\./' + exclude + '\.js$' })
        .join('|'));

      nmf.plugin("before-resolve", function (result, callback) {
        if(!result) return callback();
        if(excluded.test(result.request)){
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

      // Create path for internal build of the meteor packages.
      const meteorBuild = getMeteorBuild(nmf.context);

      // Create path for meteor app packages directory.
      const meteorPackages = path.join(meteorBuild, 'packages');

      const manifest = getManifest(nmf.context);

      const extraRules = [
        {
          meteorImports: true,
          test: /meteor-config$/,
          include: [__dirname],
          use: {
            loader: 'json-string-loader',
            options: {json: JSON.stringify(self.config)}
          }
        },
        {
          meteorImports: true,
          test: PACKAGES_REGEX_NOT_MODULES,
          loader: 'imports-loader?this=>window',
        },
        {
          meteorImports: true,
          test: PACKAGES_REGEX_MODULES,
          loader: path.join(__dirname, 'modules-loader.js')
        },
        {
          meteorImports: true,
          test: PACKAGES_REGEX_GLOBAL_IMPORTS,
          loader: path.join(__dirname, 'global-imports-loader.js'),
          options: self.config
        },
        {
          meteorImports: true,
          test: /\.css$/,
          include: [meteorPackages],
          use: [
            {loader: 'style-loader'},
            {loader: 'css-loader'}
          ]
        }
      ];
      manifest.forEach(function (pckge) {
        if (!excluded.test(pckge.path)) {
          const rule = {
            meteorImports: true,
            test: new RegExp(escapeForRegEx('.meteor/local/build/programs/web.browser/' + pckge.path)),
          };

          const match = /^packages\/(.+)\.js$/.exec(pckge.path);
          if (match) {
            // Note: this won't match for global-imports from Meteor 1.6.1 and up
            const packageName = match[1].replace('_', ':');
            rule.loader = 'exports-loader?Package["' + packageName + '"]';
          }

          extraRules.push(rule);
        }
      });
      nmf.ruleSet = new RuleSet(nmf.ruleSet.rules.concat(extraRules))
    });
  }
}

module.exports = MeteorImportsPlugin;
