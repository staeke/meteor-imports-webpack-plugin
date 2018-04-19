const {getFileNameWoExt} = require('./utils');

module.exports = function(source) {
  const name = getFileNameWoExt(this.resource);
  const fileEntry = source.match(/(\/+\s+)+(packages|app)/m);
  if (!fileEntry) {
    if (this.query.stripPackagesWithoutFiles)
      return '';


    console.log('File', name, 'seems to be empty');
  }
  return source + ';\nmodule.exports = window.Package["' + name + '"];\n';
};
