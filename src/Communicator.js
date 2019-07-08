const nanoid = require('nanoid');
const RabbitClient = require('rabbit-client');
const ListenerContext = require('./ListenerContext');
const { ControllablePromise } = require('./utils');

module.exports = class Communicator {
  constructor(settings) {
    if (!settings) {
      throw new Error('No settings passed to the Communicator constructor');
    }

    const {
      rabbitClient,
      rabbitOptions,
      targetServiceName,
      metadata = {},
      useAsk = false,
      askTimeout = 5e3,
      isInputEnabled = true,
      isOutputEnabled = true,
      shouldDiscardMessages = false,
      namespace = 'rabbit-communications',
    } = settings;

    if (!targetServiceName) {
      throw new Error('Target service name is required');
    }

    if (!isInputEnabled && !isOutputEnabled) {
      throw new Error(`
        Both input and output cannot be disabled.
        At least one communication channel is required
      `);
    }

    if (!rabbitClient && !rabbitOptions) {
      throw new Error(`
        It is necessary to pass to the constructor either your own rabbitClient (RabbitClient instance)
        or rabbitOptions to create RabbitClient instance within the service.
      `);
    }

    if (!isInputEnabled && shouldDiscardMessages) {
      throw new Error('There\'s no point to set "shouldDiscardMessages" flag to "true" if service\'s output is disabled');
    }

    this.useAsk = useAsk;
    this.metadata = metadata;
    this.namespace = namespace;
    this.askTimeout = askTimeout;
    this.rabbitClient = rabbitClient;
    this.rabbitOptions = rabbitOptions;
    this.targetServiceName = targetServiceName;
    this.isInputEnabled = useAsk || isInputEnabled;
    this.isOutputEnabled = useAsk || isOutputEnabled;
    this.shouldDiscardMessages = shouldDiscardMessages;

    this.inputQueueName = `${namespace}:${this.targetServiceName}:input`;
    this.outputQueueName = `${namespace}:${this.targetServiceName}:output`;

    this.askMap = {}; // messageId -> ControllablePromise instance (see utils)

    this.isCommunicatorStarted = false;
  }

  addOutputListener(fn) {
    if (!this.isOutputEnabled) {
      throw new Error('Service output channel is disabled, therefore output listener would never be called');
    }

    this.outputListener = fn;
  }

  async send(data, additionalMetadata = {}) {
    if (!this.isInputEnabled) {
      throw new Error('Service input channel is disabled, can not send message');
    }

    await this.verifyStart();

    const messageId = nanoid(10);

    const metadata = {
      ...this.metadata,
      ...additionalMetadata,
      messageId,
    };

    const payload = {
      metadata,
      data,
    };

    await this.inputChannel.publish(this.namespace, this.inputQueueName, payload);

    return messageId;
  }

  async ask(subject, data, additionalMetadata = {}) {
    const controllablePromise = new ControllablePromise();

    const messageId = await this.send(data, {
      ...additionalMetadata,
      ask: true,
      subject,
    });

    controllablePromise.setResolveTimeout(
      this.askTimeout,
      `The service did not respond within the allowed ${this.askTimeout} milliseconds`,
    );

    // To see the use of this object see the consume callback below in start() method
    this.askMap[messageId] = controllablePromise;

    return controllablePromise;
  }

  async start() {
    if (!this.rabbitClient) {
      this.rabbitClient = new RabbitClient(this.rabbitOptions.url, {
        appName: `${this.targetServiceName}-communicator`,
        sleepTime: 1e3,
        json: true,
      });
    }

    if (this.isInputEnabled) {
      this.inputChannel = await this.rabbitClient.getChannel({
        onReconnect: async (channel) => {
          await channel.assertExchange(this.namespace, 'direct');
          await channel.assertQueue(this.inputQueueName);
          await channel.bindQueue(this.inputQueueName, this.namespace, this.inputQueueName);
        },
      });
    }

    if (this.isOutputEnabled) {
      if (typeof this.outputListener !== 'function' && !this.useAsk) {
        throw new Error('Service output is enabled but no listener is provided');
      }

      this.outputChannel = await this.rabbitClient.getChannel({
        onReconnect: async (channel) => {
          await channel.assertExchange(this.namespace, 'direct');

          await channel.assertQueue(this.outputQueueName);

          await channel.bindQueue(this.outputQueueName, this.namespace, this.outputQueueName);

          await channel.consume(this.outputQueueName, async (msg, ch, parsedMessage) => {
            try {
              const { data, metadata } = parsedMessage;

              if (metadata.isReplyTo !== undefined) {
                this.askMap[metadata.isReplyTo].resolve(parsedMessage);

                delete this.askMap[metadata.isReplyTo];
              } else {
                const ctx = new ListenerContext({
                  communicator: this,
                  rabbitMessage: msg,
                  rabbitChannel: ch,
                  metadata,
                  data,
                });

                await this.outputListener(ctx);
              }

              await ch.ack(msg);
            } catch (e) {
              console.error(e);
              await ch.nack(msg, false, !this.shouldDiscardMessages);
            }
          });
        },
      });
    }

    this.isCommunicatorStarted = true;

    if (process.env.NODE_ENV !== 'test') {
      console.log(`Communicator for service "${this.targetServiceName}" successfully started`);
      console.log(`﹂RabbitMQ connection url: ${this.rabbitClient.rabbitUrl}`);
      console.log(`﹂Target service's input queue name: ${this.isInputEnabled ? this.inputQueueName : 'DISABLED'}`);
      console.log(`﹂Target service's output queue name: ${this.isOutputEnabled ? this.outputQueueName : 'DISABLED'}\n`);
    }
  }

  async verifyStart() {
    return new Promise((resolve) => {
      if (this.isCommunicatorStarted) {
        resolve();
        return;
      }

      // wait for instance to start
      const intervalId = setInterval(() => {
        if (this.isCommunicatorStarted) {
          clearInterval(intervalId);
          resolve();
        }
      }, 50);
    });
  }
};
