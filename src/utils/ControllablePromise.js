/*
 * This constructor-function returns Promise
 * that you can resolve or reject
 * outside the Promise initialization callback
 *
 * So you can control this Promise
 * state manually in your code
 *
 * Usage:
 * const promise = new ControllablePromise();
 *
 * promise.then(console.log);

 * promise.resolve('test');
 *
 * output -> 'test'
 */

module.exports = function ControllablePromise() {
  let resolve;
  let reject;

  const promise = new Promise((res, rej) => {
    /*
     * this callback is not asynchronous
     * it is called synchronously during
     * the initialization of the Promise instance
     */

    resolve = res;
    reject = rej;
  });

  /*
   * so we can access "resolve" and "reject" variables
   * right after initialization without worrying
   * about this variables being undefined
   */

  let resolveTimeoutId;

  promise.setResolveTimeout = (ms, message) => {
    resolveTimeoutId = setTimeout(() => reject(new Error(
      message || `ControllablePromise was not resolved within the allowed ${ms} milliseconds`,
    )), ms);
  };

  promise.resolve = (value) => {
    clearTimeout(resolveTimeoutId);
    resolve(value);
  };

  promise.reject = (e) => {
    clearTimeout(resolveTimeoutId);
    reject(e);
  };

  return promise;
};
