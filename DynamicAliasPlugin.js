const path = require('path');

module.exports = class DynamicAliasPlugin {
  constructor(resolverFn) {
    this.source = 'described-resolve';
    this.target = 'resolve';
    this.resolverFn = resolverFn;
  }

  apply(resolver) {
    const target = resolver.ensureHook(this.target);
    resolver.getHook(this.source).tapAsync('DynamicAliasPlugin', (request, resolveContext, callback) => {
      const innerRequest = request.request;
      if (!innerRequest) return callback();

      const newRequest = this.resolverFn(innerRequest);
      if (!newRequest) return callback();

      const obj = Object.assign({}, request, {request: newRequest});

      if (typeof newRequest === 'function') {
        debugger
        return callback(null, request);
      }

      return resolver.doResolve(target, obj, `aliased '${innerRequest}' to '${newRequest}'`, resolveContext, (err, result) => {
        if (err) return callback(err);

        // Don't allow other aliasing or raw request
        if (result === undefined) return callback(null, null);
        callback(null, result);
      });
    });
  }
};
