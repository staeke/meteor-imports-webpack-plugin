const fs = require('fs');
const _ = require('lodash');
const md5 = require('md5');
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
    return escapeForRegEx(x);
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

const PLUGIN_NAME = 'MeteorImportsWebpackPlugin';


class MeteorImportsPlugin {
  constructor(options) {
    this.options = options;

    // TODO: Remove empty packages
  }

  apply(compiler) {
    this.initConfig(compiler.options);
    this.setPaths(compiler);
    this.readPackages();
    compiler.hooks.compile.tap(PLUGIN_NAME, params => {
      this.addLoaders(params);
    });

    compiler.hooks.afterResolvers.tap(PLUGIN_NAME, compiler => {
      compiler.resolverFactory.hooks.resolver
        .for("normal")
        .tap(PLUGIN_NAME, resolver => {
          this.addAliases(resolver);
        });
    });

    this.setupAutoupdate(compiler);
  }

  initConfig(wpConfig) {
    const production = wpConfig.mode === 'production';

    const defaults = {
      meteorEnv: {
        NODE_ENV: production ? 'production' : undefined
      },
      autoupdate: 'auto',
      reload: 'auto',
      stripPackagesWithoutFiles: true,
      emitAutoupdateVersion: 'auto',
      exclude: {}
    };

    this.config = Object.assign(defaults, this.options);
    const exc = this.config.exclude;
    if (Array.isArray(exc))
      this.config.exclude = _.zipObject(exc, exc.map(k => true));

    const useAutoupdate = this.config.autoupdate || (this.config.autoupdate === 'auto' && production);
    if (!useAutoupdate) {
      this.config.exclude['autoupdate'] = true;
    }

    const useReload = this.config.reload || (this.config.reload === 'auto' && production);
    if (!useReload) {
      this.config.exclude['reload'] = true;
    }
  }

  setPaths(compiler) {
    const context = compiler.context;

    this.meteorBuild = this.config.meteorProgramsFolder
      ? path.resolve(context, this.config.meteorProgramsFolder, 'web.browser')
      : path.resolve.apply(path, [context, this.config.meteorFolder].concat(BUILD_PATH_PARTS));

    this.meteorPackages = path.join(this.meteorBuild, 'packages');
  }

  readPackages() {
    let manifest;
    try {
      manifest = require(this.meteorBuild + '/program.json').manifest;
    } catch (e) {
      throw Error('Run Meteor at least once and wait for startup to complete.');
    }

    this.packages = manifest
      .filter(x => x.type === 'js' || x.type === 'css')
      .filter(x => x.path !== 'app/app.js')
      .map(x => {
        const match = x.path.match(/(packages|app)\/(.+)\.[^.]+$/);
        if (!match) {
          console.error('Unexpected package path', x.path);
          return null;
        }
        const name = match[2];
        const excludeEntry = this.config.exclude[name];
        if (excludeEntry === true)
          return null;
        if (typeof excludeEntry === 'string')
          return ({name: name, source: excludeEntry});
        return ({name: name || x.path, path: x.path});
      })
      .filter(x => !!x);

    if (this.config.logIncludedPackages)
      console.log('Included Meteor packages:', this.packages.map(p => p.name).join(', '));
  }

  addAliases(resolver) {
    // Provide the alias "meteor-imports"
    new AliasPlugin('described-resolve', {
      name: 'meteor-imports',
      onlyModule: true,
      alias: path.join(__dirname, './meteor-imports-loader.js'),
    }, 'resolve').apply(resolver);

    // Provide aliases for all packages so that they can be imported
    for (let pkg of this.packages) {
      if (!pkg.path) continue; // can be just a source string
      new AliasPlugin('described-resolve', {
        name: 'meteor/' + pkg.name,
        onlyModule: true,
        alias: path.join(this.meteorBuild, pkg.path),
      }, 'resolve').apply(resolver);
    }
  }

  addLoaders(params) {
    const extraRules = [
      {
        meteorImports: true,
        test: /meteor-imports-loader\.js/,
        loader: path.join(__dirname, 'meteor-imports-loader.js'),
        options: {
          packages: this.packages,
          config: this.config
        }
      },
      {
        meteorImports: true,
        test: PACKAGES_REGEX_NOT_MODULES,
        use: [
          {
            loader: path.join(__dirname, 'package-loader.js'),
            options: this.config
          },
          {loader: 'imports-loader?this=>window'},
        ]
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
        options: this.config
      },
      {
        meteorImports: true,
        test: /\.css$/,
        include: [this.meteorPackages],
        use: [
          {loader: 'style-loader'},
          {loader: 'css-loader'}
        ]
      }
    ];
    const nmf = params.normalModuleFactory;
    nmf.ruleSet = new RuleSet(nmf.ruleSet.rules.concat(extraRules));
  }

  setupAutoupdate(compiler) {
    if (this.config.emitAutoupdateVersion) {
      compiler.hooks.afterPlugins.tap(PLUGIN_NAME, compiler => {
        compiler.hooks.compilation.tap(PLUGIN_NAME, compilation => {
          compilation.hooks.htmlWebpackPluginAfterHtmlProcessing.tap(PLUGIN_NAME, data => {
            const hash = md5(data.html);
            data.html = data.html.replace(/(<\s*head\s*>)/,
              `$1\n<script>window.__meteor_runtime_config__ = {autoupdateVersion:"${hash}"}</script>`);

            // Also kick off an async write to the output file
            let outputPath = compiler.options.output.path;
            const outputFile = path.join(outputPath, 'autoupdate_version');
            fs.writeFile(outputFile, hash, err => {
              if (err) console.error(err);
              else console.log('Wrote autoupdate_version file to ', outputFile);
            })
          });
        });
      });
    }
  }
}

module.exports = MeteorImportsPlugin;
