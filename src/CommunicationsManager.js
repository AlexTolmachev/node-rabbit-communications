const RabbitClient = require('rabbit-client');
const Communicator = require('./Communicator');

module.exports = class CommunicationsManager {
  constructor(settings) {
    if (!settings) {
      throw new Error('No settings passed to the CommunicationsManager constructor');
    }

    const {
      rabbitClient,
      rabbitOptions,
      namespace = 'rabbit-communications',
    } = settings;

    if (!rabbitClient && !rabbitOptions) {
      throw new Error(`
        It is necessary to pass to the constructor either your own rabbitClient (RabbitClient instance)
        or rabbitOptions to create RabbitClient instance within the service.
      `);
    }

    this.namespace = namespace;
    this.rabbitOptions = rabbitOptions;

    this.rabbitClient = rabbitClient || new RabbitClient(this.rabbitOptions.url, {
      appName: `${this.namespace}-communicator-manager`,
      sleepTime: 1e3,
      json: true,
      ...this.rabbitOptions,
    });

    this.communicatorMap = {};
    this.rootMiddlewareList = [];
    this.specificMiddlewareMap = {};

    this.isManagerStarted = false;
  }

  isCommunicatorRegistered(targetServiceName) {
    return this.communicatorMap[targetServiceName] !== undefined;
  }

  registerCommunicator(targetServiceName, communicatorOptions, outputListener) {
    if (this.isCommunicatorRegistered(targetServiceName)) {
      throw new Error(`Communicator for service ${targetServiceName} is already registered`);
    }

    this.communicatorMap[targetServiceName] = new Communicator({
      ...communicatorOptions,
      rabbitClient: this.rabbitClient,
      namespace: this.namespace,
      manager: this,
      targetServiceName,
    });

    if (typeof outputListener === 'function') {
      this.addOutputListener(targetServiceName, outputListener);
    }
  }

  async send(targetServiceName, data, metadata = {}) {
    await this.verifyStart();

    const targetServiceCommunicator = this.communicatorMap[targetServiceName];

    if (!this.isCommunicatorRegistered(targetServiceName)) {
      throw new Error(`No communicator registered for service "${targetServiceName}"`);
    }

    return targetServiceCommunicator.send(data, metadata);
  }

  async broadcast(data, metadata = {}) {
    await this.verifyStart();

    return Promise.all(
      Object.values(this.communicatorMap).map(communicator => communicator.send(data, metadata)),
    );
  }

  applyMiddleware(...args) {
    if (args[1] !== undefined) {
      const specificMiddlewareList = Array.isArray(args[1]) ? args[1] : [args[1]];
      const targetServiceNameList = Array.isArray(args[0]) ? args[0] : [args[0]];

      targetServiceNameList.forEach((serviceName) => {
        const list = this.specificMiddlewareMap[serviceName];

        if (list === undefined) {
          this.specificMiddlewareMap[serviceName] = [];
        }

        this.specificMiddlewareMap[serviceName].push(...specificMiddlewareList);
      });
    } else {
      const newRootMiddlewareList = Array.isArray(args[0]) ? args[0] : [args[0]];

      this.rootMiddlewareList.push(...newRootMiddlewareList);
    }
  }

  addOutputListener(targetServiceName, fn) {
    const targetServiceCommunicator = this.communicatorMap[targetServiceName];

    if (!this.isCommunicatorRegistered(targetServiceName)) {
      throw new Error(`No communicator registered for service "${targetServiceName}"`);
    }

    return targetServiceCommunicator.addOutputListener(fn);
  }

  async start() {
    await Promise.all(
      Object.values(this.communicatorMap).map((communicator) => {
        if (typeof communicator.outputListener === 'function') {
          const middlewareList = [
            ...this.rootMiddlewareList,
            ...(this.specificMiddlewareMap[communicator.targetServiceName] || []),
            communicator.outputListener,
          ];

          const middlewareChain = middlewareList.map(
            (m, i) => ctx => m(ctx, () => middlewareChain[i + 1](ctx)),
          );

          // eslint-disable-next-line no-param-reassign
          communicator.outputListener = ctx => middlewareChain[0](ctx);
        }

        return communicator.start();
      }),
    );

    this.isManagerStarted = true;
  }

  async verifyStart() {
    return new Promise((resolve) => {
      if (this.isManagerStarted) {
        resolve();
        return;
      }

      // wait for instance to start
      const intervalId = setInterval(() => {
        if (this.isManagerStarted) {
          clearInterval(intervalId);
          resolve();
        }
      }, 50);
    });
  }
};
