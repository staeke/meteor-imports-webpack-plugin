const fs = require('fs');
const _ = require('lodash');
const md5 = require('md5');
const path = require('path');
const RuleSet = require('webpack/lib/RuleSet');
const AliasPlugin = require('enhanced-resolve/lib/AliasPlugin');
const {log, logWarn, logError} = require('./utils');

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
  // Properties:
  // isDevServer;
  // options;
  // compiler;
  // config;

  constructor(options) {
    this.options = options;
    this.isDevServer = process.argv.find(v => v.includes('webpack-dev-server'));
  }

  apply(compiler) {
    this.compiler = compiler;

    this.initConfig();
    this.setPaths();
    this.readPackages();

    compiler.hooks.compile.tap(PLUGIN_NAME, params => {
      this.addLoaders(params);
    });

    compiler.hooks.afterResolvers.tap(PLUGIN_NAME, compiler => {
      compiler.resolverFactory.hooks.resolver.for('normal').tap(PLUGIN_NAME, resolver => {
        this.addAliases(resolver);
      });
    });

    this.setupAutoupdateEmit();
  }

  initConfig() {
    const defaults = {
      exclude: {
        autoupdate: !this.isDevServer
      },
      meteorEnv: {
        NODE_ENV: production ? 'production' : undefined
      },
      stripPackagesWithoutFiles: true,
      emitAutoupdateVersion: 'auto',
    };

    let exclude = this.options.exclude || {};
    if (Array.isArray(exclude))
      exclude = _.zipObject(exclude, exclude.map(_ => true));
    Object.assign(defaults.exclude, exclude);

    this.config = Object.assign(defaults, this.options, {exclude});
  }

  setPaths() {
    const context = this.compiler.context;

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
        if (typeof excludeEntry === 'object') {
          if (!excludeEntry.mode) {
            logWarn('Unrecognized exclude entry for package ' + name);
            return true;
          }
          if (excludeEntry.mode === this.getMode())
            return true;
        }

        if (name === 'autocomplete' && this.isDevServer) {
          logWarn('You have specified using autoupdate: true while running webpack-dev-server. ' +
            'This typically leads to a ever reloading page if you don\'t start/stop meteor all ' +
            'the time and provide environment variable AUTOUPDATE_VERSION. ' +
            'Are you sure this is what you want to do?');
        }
        return ({name: name || x.path, path: x.path});
      })
      .filter(x => !!x);

    if (this.config.logIncludedPackages)
      log('Included Meteor packages:', this.packages.map(p => p.name).join(', '));
  }

  getMode() {
    return this.compiler.options.mode || 'development';
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

  setupAutoupdateEmit() {
    if (this.config.exclude['autoupdate'] === true || !this.config.emitAutoupdateVersion)
      return;

    this.compiler.hooks.afterPlugins.tap(PLUGIN_NAME, compiler => {
      compiler.hooks.compilation.tap(PLUGIN_NAME, compilation => {
        let afterHtmlHook = compilation.hooks.htmlWebpackPluginAfterHtmlProcessing;
        if (!afterHtmlHook) {
          logError('The emitAutoupdateVersion setting requires HtmlWebpackPlugin being added and it wasn\'t found.');
          return;
        }
        afterHtmlHook.tap(PLUGIN_NAME, data => {
          const hash = md5(data.html);
          data.html = data.html.replace(/(<\s*head\s*>)/,
            `$1\n<script>window.__meteor_runtime_config__ = {autoupdateVersion:"${hash}"}</script>`);

          // Also kick off an async write to the output file
          let outputPath = compiler.options.output.path;
          const outputFile = path.join(outputPath, 'autoupdate_version');
          fs.writeFile(outputFile, hash, err => {
            if (err) logError('Unable to write autoupdate_version file', err);
            else log('Wrote autoupdate_version file to ', outputFile);
          });
        });
      });
    });
  }
}

module.exports = MeteorImportsPlugin;
