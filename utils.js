const path = require('path');

module.exports = {
  getFileNameWoExt: file => path.basename(file, path.extname(file))
};
