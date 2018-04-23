const {getFileNameWoExt, logWarn} = require('./utils');

module.exports = function(source) {
  const name = getFileNameWoExt(this.resource);
  const fileEntry = source.match(/(\/+\s+)+(packages|app)/m);
  if (!fileEntry) {
    if (this.query.stripPackagesWithoutFiles)
      return '';

    if (this.query.logPackagesWithoutFiles)
      logWarn('File', name, 'seems to not include any file and can probably be excluded');
  }
  return source + ';\nmodule.exports = window.Package["' + name + '"];\n';
};
