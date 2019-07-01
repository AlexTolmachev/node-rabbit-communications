const { expect } = require('chai');
const { Service, RabbitClient } = require('../src');

const { RABBIT_URL } = process.env;

describe('Service (allows to exchange messages with it in both directions)', () => {
  const NAMESPACE = 'namespace-1';

  const rabbitClient = new RabbitClient(RABBIT_URL, {
    disableLogging: true,
    appName: NAMESPACE,
    json: true,
  });

  const createdQueues = [];

  after(async () => {
    try {
      const channel = await rabbitClient.getChannel();

      await Promise.all(createdQueues.map(queue => channel.deleteQueue(queue).catch(() => {})));
      await channel.deleteExchange(NAMESPACE);
    } catch (e) {
      // ignore clean-up errors
    }
  });

  it('start method throws exception if input channel is enabled but no listener provided', async () => {
    const service = new Service({
      isOutputEnabled: false,
      isInputEnabled: true,
      namespace: NAMESPACE,
      name: 'service-1',
      rabbitClient,
    });

    // no service.addInputListener(fn) call here..

    let isErrorCaught = false;

    try {
      await service.start();
    } catch (e) {
      isErrorCaught = true;
    }

    expect(isErrorCaught).to.be.equal(true);
  });

  it('creates input and output queues', async () => {
    const serviceName = 'service-2';

    const service = new Service({
      isOutputEnabled: true,
      isInputEnabled: true,
      namespace: NAMESPACE,
      name: serviceName,
      rabbitClient,
    });

    service.addInputListener(() => {}); // required to start service

    await service.start();

    const { inputQueueName, outputQueueName } = service;

    createdQueues.push(inputQueueName, outputQueueName);

    expect(inputQueueName).to.be.a('string');
    expect(outputQueueName).to.be.a('string');
    expect(inputQueueName).to.be.equal(`${NAMESPACE}:${serviceName}:input`);
    expect(outputQueueName).to.include(`${NAMESPACE}:${serviceName}:output`);

    const doesInputQueueExist = await service.inputChannel.checkQueue(inputQueueName);
    const doesOutputQueueExist = await service.outputChannel.checkQueue(outputQueueName);

    expect(doesInputQueueExist).not.to.be.equal(undefined);
    expect(doesOutputQueueExist).not.to.be.equal(undefined);
  });

  it('allows to turn off input or output functionality', async () => {
    const inputServiceName = 'service-3.1-input-only';
    const outputServiceName = 'service-3.2-output-only';

    const inputService = new Service({
      name: inputServiceName,
      isOutputEnabled: false,
      isInputEnabled: true,
      namespace: NAMESPACE,
      rabbitClient,
    });

    const outputService = new Service({
      name: outputServiceName,
      isOutputEnabled: true,
      isInputEnabled: false,
      namespace: NAMESPACE,
      rabbitClient,
    });

    inputService.addInputListener(() => {});

    await inputService.start();
    await outputService.start();

    createdQueues.push(inputService.inputQueueName, outputService.outputQueueName);

    expect(inputService.outputChannel).to.be.equal(undefined);
    expect(inputService.inputChannel).not.to.be.equal(undefined);
    expect(outputService.inputChannel).to.be.equal(undefined);
    expect(outputService.outputChannel).not.to.be.equal(undefined);

    let areQueuesThatShouldExistSuccessfullyChecked = false;

    try {
      await inputService.inputChannel.checkQueue(inputService.inputQueueName);
      await outputService.outputChannel.checkQueue(outputService.outputQueueName);

      areQueuesThatShouldExistSuccessfullyChecked = true;
    } catch (e) {
      // ignore error, we are just interested in flag above
    }

    let isInputServiceOutputQueueSuccessfullyChecked = false;

    try {
      await inputService.inputChannel.checkQueue(inputService.outputQueueName);
    } catch (e) {
      // if queue does not exist, exception would be thrown
      isInputServiceOutputQueueSuccessfullyChecked = true;
    }

    let isOutputServiceInputQueueSuccessfullyChecked = false;

    try {
      await outputService.outputChannel.checkQueue(outputService.inputQueueName);
    } catch (e) {
      // if queue does not exist, exception would be thrown
      isOutputServiceInputQueueSuccessfullyChecked = true;
    }

    expect(areQueuesThatShouldExistSuccessfullyChecked).to.be.equal(true);
    expect(isInputServiceOutputQueueSuccessfullyChecked).to.be.equal(true);
    expect(isOutputServiceInputQueueSuccessfullyChecked).to.be.equal(true);
  });

  it('calls listener on input queue messages', async () => {
    const testChannel = await rabbitClient.getChannel();

    const service = new Service({
      name: 'service-4-input-only',
      isOutputEnabled: false,
      isInputEnabled: true,
      namespace: NAMESPACE,
      rabbitClient,
    });

    const messagesToSend = new Array(100).fill(null).map(() => ({ test: Math.random() }));
    const receivedMessages = [];

    service.addInputListener((ctx) => {
      receivedMessages.push(ctx.data);
    });

    await service.start();

    createdQueues.push(service.inputQueueName);

    await Promise.all(
      messagesToSend.map(msg => testChannel.publish(
        service.namespace,
        service.inputQueueName,
        { data: msg, metadata: {} },
      )),
    );

    const areMessagesReceivedByService = await new Promise((resolve) => {
      const timeoutId = setTimeout(() => resolve(false), 2e3);

      const intervalId = setInterval(() => {
        if (receivedMessages.length === messagesToSend.length) {
          const areAllMessagesReceived = messagesToSend.map(
            item => receivedMessages.some(receivedItem => receivedItem.test === item.test),
          ).every(Boolean);

          if (areAllMessagesReceived) {
            clearTimeout(timeoutId);
            clearInterval(intervalId);

            resolve(true);
          }
        }
      }, 100);
    });

    expect(areMessagesReceivedByService).to.be.equal(true);
  });

  it('sends messages to output queue', async () => {
    const service = new Service({
      name: 'service-5-output-only',
      isOutputEnabled: true,
      isInputEnabled: false,
      namespace: NAMESPACE,
      rabbitClient,
    });

    const { outputQueueName } = service;

    await service.start();

    createdQueues.push(outputQueueName);

    const messagesToSend = new Array(100).fill(null).map(() => ({ test: Math.random() }));
    const receivedMessages = [];

    await rabbitClient.getChannel({
      onReconnect: async (channel) => {
        channel.consume(outputQueueName, async (msg, ch, parsedMessage) => {
          receivedMessages.push(parsedMessage.data);
          await ch.ack(msg);
        });
      },
    });

    await Promise.all(
      messagesToSend.map(msg => service.send(msg)),
    );

    const areAllMessagesSentByService = await new Promise((resolve) => {
      const timeoutId = setTimeout(() => resolve(false), 2e3);

      const intervalId = setInterval(() => {
        if (receivedMessages.length === messagesToSend.length) {
          const areAllMessagesSent = messagesToSend.map(
            item => receivedMessages.some(receivedItem => receivedItem.test === item.test),
          ).every(Boolean);

          if (areAllMessagesSent) {
            clearTimeout(timeoutId);
            clearInterval(intervalId);

            resolve(true);
          }
        }
      }, 100);
    });

    expect(areAllMessagesSentByService).to.be.equal(true);
  });

  it('requeues message to input queue on listener\'s exceptions (shouldDiscardMessages = false)', async () => {
    const testChannel = await rabbitClient.getChannel();

    const service = new Service({
      name: 'service-6-input-only',
      shouldDiscardMessages: false,
      isOutputEnabled: false,
      isInputEnabled: true,
      namespace: NAMESPACE,
      rabbitClient,
    });

    const messagesToSend = new Array(3).fill(null).map(() => ({ test: Math.random() }));
    const receivedMessages = [];
    const receivedRequeuedMessages = [];

    service.addInputListener(({ data }) => {
      if (receivedMessages.some(receivedItem => receivedItem.test === data.test)) {
        receivedRequeuedMessages.push(data);
      } else {
        receivedMessages.push(data);

        throw new Error('Service test exception');
      }
    });

    await service.start();

    createdQueues.push(service.inputQueueName);

    await Promise.all(
      messagesToSend.map(msg => testChannel.publish(
        service.namespace,
        service.inputQueueName,
        { data: msg, metadata: {} },
      )),
    );

    const areMessagesReceivedByService = await new Promise((resolve) => {
      const timeoutId = setTimeout(() => resolve(false), 2e3);

      const intervalId = setInterval(() => {
        if (receivedMessages.length !== messagesToSend.length) {
          return;
        }

        if (receivedRequeuedMessages.length !== receivedMessages.length) {
          return;
        }

        const areAllMessagesReceived = messagesToSend.map(
          item => receivedMessages.some(receivedItem => receivedItem.test === item.test),
        ).every(Boolean);

        const areAllRequeuedMessagesReceived = messagesToSend.map(
          item => receivedRequeuedMessages.some(receivedItem => receivedItem.test === item.test),
        ).every(Boolean);

        if (areAllMessagesReceived && areAllRequeuedMessagesReceived) {
          clearTimeout(timeoutId);
          clearInterval(intervalId);

          resolve(true);
        }
      }, 100);
    });

    expect(areMessagesReceivedByService).to.be.equal(true);
  });

  it('discards messages on listener\'s exceptions (shouldDiscardMessages = true)', async () => {
    const testChannel = await rabbitClient.getChannel();

    const service = new Service({
      name: 'service-7-input-only',
      shouldDiscardMessages: true,
      isOutputEnabled: false,
      isInputEnabled: true,
      namespace: NAMESPACE,
      rabbitClient,
    });

    const messagesToSend = new Array(3).fill(null).map(() => ({ test: Math.random() }));
    const receivedMessages = [];
    const receivedRequeuedMessages = [];

    service.addInputListener(({ data }) => {
      if (receivedMessages.some(receivedItem => receivedItem.test === data.test)) {
        receivedRequeuedMessages.push(data);
      } else {
        receivedMessages.push(data);

        throw new Error('Service discard test');
      }
    });

    await service.start();

    createdQueues.push(service.inputQueueName);

    await Promise.all(
      messagesToSend.map(msg => testChannel.publish(
        service.namespace,
        service.inputQueueName,
        { data: msg, metadata: {} },
      )),
    );

    const areMessagesReceivedByService = await new Promise((resolve) => {
      const timeoutId = setTimeout(() => resolve(false), 2e3);

      const intervalId = setInterval(() => {
        if (receivedMessages.length !== messagesToSend.length) {
          return;
        }

        const areAllMessagesReceived = messagesToSend.map(
          item => receivedMessages.some(receivedItem => receivedItem.test === item.test),
        ).every(Boolean);

        const areAllRequeuedMessagesDiscarded = receivedRequeuedMessages.length === 0;

        if (areAllMessagesReceived && areAllRequeuedMessagesDiscarded) {
          clearTimeout(timeoutId);
          clearInterval(intervalId);

          resolve(true);
        }
      }, 100);
    });

    expect(areMessagesReceivedByService).to.be.equal(true);
  });

  it('passes itself to input listener and allows to send output messages using it', async () => {
    const service = new Service({
      shouldDiscardMessages: true,
      isOutputEnabled: true,
      isInputEnabled: true,
      namespace: NAMESPACE,
      name: 'service-8',
      rabbitClient,
    });

    service.addInputListener((ctx) => {
      ctx.service.send(ctx.data); // input queue -> output queue "echo"
    });

    await service.start();

    const { namespace, inputQueueName, outputQueueName } = service;

    createdQueues.push(inputQueueName, outputQueueName);

    let isOutputMessageReceived = false;

    const testChannel = await rabbitClient.getChannel({
      onReconnect: async (channel) => {
        channel.consume(outputQueueName, async (msg, ch) => {
          isOutputMessageReceived = true;

          await ch.ack(msg);
        });
      },
    });

    await testChannel.publish(
      namespace,
      inputQueueName,
      { data: {}, metadata: {} },
    );

    const isEchoMessageReceived = await new Promise((resolve) => {
      const timeoutId = setTimeout(() => resolve(false), 2e3);

      const intervalId = setInterval(() => {
        if (isOutputMessageReceived) {
          clearTimeout(timeoutId);
          clearInterval(intervalId);

          resolve(true);
        }
      }, 100);
    });

    expect(isEchoMessageReceived).to.be.equal(true);
  });

  it('allows to pass custom metadata to use it in every output message', async () => {
    const serviceMetadata = {
      num: 1,
      boo: true,
      str: 'foo',
    };

    const service = new Service({
      name: 'service-9-output-only',
      isOutputEnabled: true,
      isInputEnabled: false,
      namespace: NAMESPACE,
      metadata: serviceMetadata,
      rabbitClient,
    });

    const { outputQueueName } = service;

    await service.start();

    createdQueues.push(outputQueueName);

    let receivedMessageMetadata;

    await rabbitClient.getChannel({
      onReconnect: async (channel) => {
        channel.consume(outputQueueName, async (msg, ch, parsedMessage) => {
          receivedMessageMetadata = parsedMessage.metadata;
          await ch.ack(msg);
        });
      },
    });

    await service.send({ foo: 'bar' });

    await new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => reject(), 2e3);

      const intervalId = setInterval(() => {
        if (!receivedMessageMetadata) {
          return;
        }

        clearTimeout(timeoutId);
        clearInterval(intervalId);

        resolve();
      }, 100);
    });

    expect(receivedMessageMetadata).to.be.eql(serviceMetadata);
  });
});
