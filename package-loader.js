const {getFileNameWoExt, logWarn} = require('./utils');

module.exports = function(source) {
  const name = getFileNameWoExt(this.resource);

  // Too brittle?
  const nameWithColon = name.replace(/_/, ':');

  const pkgInternalFileEntry = source.match(/(\/+\s+)+(packages|app)/m);
  if (!pkgInternalFileEntry) {
    if (this.query.stripPackagesWithoutFiles)
      return '';

    if (this.query.logPackagesWithoutFiles)
      logWarn('File', name, 'seems to not include any file and can probably be excluded');
  }

  return source + '\nmodule.exports = window.Package["' + nameWithColon + '"];\n' +
    'Object.defineProperty(module.exports, "__esModule", { value: true });\n';
};
