const RabbitClient = require('rabbit-client');
const ListenerContext = require('./ListenerContext');

module.exports = class Service {
  constructor(settings) {
    if (!settings) {
      throw new Error('No settings passed to the Service constructor');
    }

    const {
      name,
      rabbitClient,
      rabbitOptions,
      metadata = {},
      isInputEnabled = true,
      isOutputEnabled = true,
      shouldDiscardMessages = false,
      namespace = 'rabbit-communications',
    } = settings;

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
    this.metadata = metadata;
    this.namespace = namespace;
    this.rabbitClient = rabbitClient;
    this.rabbitOptions = rabbitOptions;
    this.isInputEnabled = isInputEnabled;
    this.isOutputEnabled = isOutputEnabled;
    this.shouldDiscardMessages = shouldDiscardMessages;

    this.inputQueueName = `${namespace}:${this.name}:input`;
    this.outputQueueName = `${namespace}:${this.name}:output`;

    this.askListenersMap = {}; // subject -> function
  }

  addInputListener(fn) {
    if (!this.isInputEnabled) {
      throw new Error('Service input channel is disabled, therefore input listener would never be called');
    }

    this.inputListener = fn;
  }

  addAskListener(subject, fn) {
    if (!this.isInputEnabled) {
      throw new Error('Service input channel is disabled, therefore ask listeners would never be called');
    }


    if (!this.isOutputEnabled) {
      throw new Error(`
        Service output channel is disabled, therefore ask listener
        will not be able to reply to the incoming message
      `);
    }

    this.askListenersMap[subject] = fn;
  }

  async send(data, additionalMetadata = {}) {
    if (!this.isOutputEnabled) {
      throw new Error('Service output channel is disabled, can not send message');
    }

    const metadata = {
      ...this.metadata,
      ...additionalMetadata,
    };

    const payload = {
      metadata,
      data,
    };

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

          await channel.assertQueue(this.outputQueueName);

          await channel.bindQueue(this.outputQueueName, this.namespace, this.outputQueueName);
        },
      });
    }

    if (this.isInputEnabled) {
      if (typeof this.inputListener !== 'function' && Object.keys(this.askListenersMap).length === 0) {
        throw new Error('Service input is enabled but no listener is provided');
      }

      this.inputChannel = await this.rabbitClient.getChannel({
        onReconnect: async (channel) => {
          await channel.assertExchange(this.namespace, 'direct');
          await channel.assertQueue(this.inputQueueName);
          await channel.bindQueue(this.inputQueueName, this.namespace, this.inputQueueName);

          await channel.consume(this.inputQueueName, async (msg, ch, parsedMessage) => {
            try {
              const { data, metadata } = parsedMessage;

              const ctx = new ListenerContext({
                rabbitMessage: msg,
                rabbitChannel: ch,
                service: this,
                metadata,
                data,
              });

              if (metadata.ask && metadata.subject !== undefined) {
                const askListener = this.askListenersMap[metadata.subject];

                if (askListener === undefined) {
                  throw new Error(`Received ask request for subject "${metadata.subject}" but no listener registered`);
                }

                await askListener(ctx);

                return;
              }

              await this.inputListener(ctx);
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
      console.log(`Service "${this.name}" successfully started`);
      console.log(`﹂RabbitMQ connection url: ${this.rabbitClient.rabbitUrl}`);
      console.log(`﹂Input queue name: ${this.isInputEnabled ? this.inputQueueName : 'DISABLED'}`);
      console.log(`﹂Output queue name: ${this.isOutputEnabled ? this.outputQueueName : 'DISABLED'}\n`);
    }
  }
};
