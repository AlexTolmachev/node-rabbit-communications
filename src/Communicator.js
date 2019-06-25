const RabbitClient = require('rabbit-client');

module.exports = class Communicator {
  constructor(options) {
    if (!options) {
      throw new Error('No options passed to the Communicator constructor');
    }

    const {
      rabbitClient,
      rabbitOptions,
      targetServiceName,
      isInputEnabled = true,
      isOutputEnabled = true,
      outputMessageTtl = 3e4,
      shouldDiscardMessages = false,
      namespace = 'rabbit-communications',
    } = options;

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
    this.outputMessageTtl = outputMessageTtl;
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

  async send(payload) {
    if (!this.isInputEnabled) {
      throw new Error('Service input channel is disabled, can not send message');
    }

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

          await channel.assertQueue(this.outputQueueName, {
            messageTtl: this.outputMessageTtl,
          });

          await channel.bindQueue(this.outputQueueName, this.namespace, this.outputQueueName);

          await channel.consume(this.outputQueueName, async (msg, ch, data) => {
            try {
              await this.outputListener(data, this);
              await ch.ack(msg);
            } catch (e) {
              console.error(e);
              await ch.nack(msg, false, !this.shouldDiscardMessages);
            }
          });
        },
      });
    }
  }
};
