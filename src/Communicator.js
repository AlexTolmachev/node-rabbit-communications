const RabbitClient = require('rabbit-client');
const ListenerContext = require('./ListenerContext');

module.exports = class Communicator {
  constructor(settings) {
    if (!settings) {
      throw new Error('No settings passed to the Communicator constructor');
    }

    const {
      rabbitClient,
      rabbitOptions,
      targetServiceName,
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

    this.namespace = namespace;
    this.rabbitClient = rabbitClient;
    this.rabbitOptions = rabbitOptions;
    this.isInputEnabled = isInputEnabled;
    this.isOutputEnabled = isOutputEnabled;
    this.targetServiceName = targetServiceName;
    this.shouldDiscardMessages = shouldDiscardMessages;

    this.inputQueueName = `${namespace}:${this.targetServiceName}:input`;
    this.outputQueueName = `${namespace}:${this.targetServiceName}:output`;
  }

  addOutputListener(fn) {
    if (!this.isOutputEnabled) {
      throw new Error('Service output channel is disabled, therefore output listener would never be called');
    }

    this.outputListener = fn;
  }

  async send(data, metadata = {}) {
    if (!this.isInputEnabled) {
      throw new Error('Service input channel is disabled, can not send message');
    }

    const payload = {
      metadata,
      data,
    };

    return this.inputChannel.publish(this.namespace, this.inputQueueName, payload);
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
      if (typeof this.outputListener !== 'function') {
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

              const ctx = new ListenerContext({
                communicator: this,
                rabbitMessage: msg,
                rabbitChannel: ch,
                metadata,
                data,
              });

              await this.outputListener(ctx);
              await ch.ack(msg);
            } catch (e) {
              console.error(e);
              await ch.nack(msg, false, !this.shouldDiscardMessages);
            }
          });
        },
      });
    }

    if (process.env.NODE_ENV !== 'test') {
      console.log(`Communicator for service "${this.targetServiceName}" successfully started`);
      console.log(`﹂RabbitMQ connection url: ${this.rabbitClient.rabbitUrl}`);
      console.log(`﹂Target service's input queue name: ${this.isInputEnabled ? this.inputQueueName : 'DISABLED'}`);
      console.log(`﹂Target service's output queue name: ${this.isOutputEnabled ? this.outputQueueName : 'DISABLED'}\n`);
    }
  }
};
