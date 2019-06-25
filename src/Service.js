const RabbitClient = require('rabbit-client');

module.exports = class Service {
  constructor(options) {
    if (!options) {
      throw new Error('No options passed to the Service constructor');
    }

    const {
      name,
      rabbitClient,
      rabbitOptions,
      isInputEnabled = true,
      isOutputEnabled = true,
      outputMessageTtl = 3e4,
      shouldDiscardMessages = false,
      namespace = 'rabbit-communications',
    } = options;

    if (!name) {
      throw new Error('Service name is required');
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
      throw new Error('There\'s no point to set "shouldDiscardMessages" flag to "true" if service\'s input is disabled');
    }

    this.name = name;
    this.namespace = namespace;
    this.rabbitClient = rabbitClient;
    this.rabbitOptions = rabbitOptions;
    this.isInputEnabled = isInputEnabled;
    this.isOutputEnabled = isOutputEnabled;
    this.outputMessageTtl = outputMessageTtl;
    this.shouldDiscardMessages = shouldDiscardMessages;

    this.inputQueueName = `${namespace}:${this.name}:input`;
    this.outputQueueName = `${namespace}:${this.name}:output`;
  }

  addInputListener(fn) {
    if (!this.isInputEnabled) {
      throw new Error('Service input channel is disabled, therefore input listener would never be called');
    }

    this.inputListener = fn;
  }

  async send(payload) {
    if (!this.isOutputEnabled) {
      throw new Error('Service output channel is disabled, can not send message');
    }

    return this.outputChannel.publish(this.namespace, this.outputQueueName, payload);
  }

  async start() {
    if (!this.rabbitClient) {
      this.rabbitClient = new RabbitClient(this.rabbitOptions.url, {
        appName: this.name,
        json: true,
      });
    }

    if (this.isOutputEnabled) {
      this.outputChannel = await this.rabbitClient.getChannel({
        onReconnect: async (channel) => {
          await channel.assertExchange(this.namespace, 'direct');

          await channel.assertQueue(this.outputQueueName, {
            messageTtl: this.outputMessageTtl,
          });

          await channel.bindQueue(this.outputQueueName, this.namespace, this.outputQueueName);
        },
      });
    }

    if (this.isInputEnabled) {
      if (typeof this.inputListener !== 'function') {
        throw new Error('Service input is enabled but no listener is provided');
      }

      this.inputChannel = await this.rabbitClient.getChannel({
        onReconnect: async (channel) => {
          await channel.assertExchange(this.namespace, 'direct');
          await channel.assertQueue(this.inputQueueName);
          await channel.bindQueue(this.inputQueueName, this.namespace, this.inputQueueName);

          await channel.consume(this.inputQueueName, async (msg, ch, data) => {
            try {
              await this.inputListener(data, this);
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
