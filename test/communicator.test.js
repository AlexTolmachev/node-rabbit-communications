const { expect } = require('chai');
const { Service, Communicator, RabbitClient } = require('../src');

const { RABBIT_URL } = process.env;

describe('Communicator (connects to specific Service for two-way communication)', () => {
  const NAMESPACE = 'namespace-2';

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


  it('allows to turn off input or output functionality (ex. ignore service, stop consuming it\'s messages)', async () => {
    const serviceName = 'service-1';

    const service = new Service({
      namespace: NAMESPACE,
      name: serviceName,
      isInputEnabled: true,
      isOutputEnabled: true,
      rabbitClient,
    });

    service.addInputListener(() => {});

    const inputCommunicator = new Communicator({
      namespace: NAMESPACE,
      targetServiceName: serviceName,
      isInputEnabled: true,
      isOutputEnabled: false,
      rabbitClient,
    });

    const outputCommunicator = new Communicator({
      namespace: NAMESPACE,
      targetServiceName: serviceName,
      isInputEnabled: false,
      isOutputEnabled: true,
      rabbitClient,
    });

    outputCommunicator.addOutputListener(() => {}); // required to start communicator

    let isInputCommunicatorErrorCaught = false;

    try {
      inputCommunicator.addOutputListener(() => {});
    } catch (e) {
      isInputCommunicatorErrorCaught = true;
    }

    expect(isInputCommunicatorErrorCaught).to.be.equal(true);

    await service.start();
    await inputCommunicator.start();
    await outputCommunicator.start();

    createdQueues.push(service.inputQueueName, service.outputQueueName);

    expect(inputCommunicator.inputChannel).not.to.be.equal(undefined);
    expect(inputCommunicator.outputChannel).to.be.equal(undefined);
    expect(outputCommunicator.outputChannel).not.to.be.equal(undefined);
    expect(outputCommunicator.inputChannel).to.be.equal(undefined);

    let isOutputCommunicatorErrorCaught = false;

    try {
      await outputCommunicator.send({ foo: 'bar' });
    } catch (e) {
      isOutputCommunicatorErrorCaught = true;
    }

    expect(isOutputCommunicatorErrorCaught).to.be.equal(true);
  });

  it('start method throws exception if service output channel is enabled but no listener provided', async () => {
    const communicator = new Communicator({
      targetServiceName: 'service-2',
      namespace: NAMESPACE,
      isInputEnabled: false,
      isOutputEnabled: true,
      rabbitClient,
    });

    // no communicator.addOutputListener(fn) call here...

    let isErrorCaught = false;

    try {
      await communicator.start();
    } catch (e) {
      isErrorCaught = true;
    }

    expect(isErrorCaught).to.be.equal(true);
  });

  it('calls listener on service\'s output queue messages', async () => {
    const serviceName = 'service-3';

    const service = new Service({
      namespace: NAMESPACE,
      name: serviceName,
      isOutputEnabled: true,
      isInputEnabled: false,
      rabbitClient,
    });

    const communicator = new Communicator({
      namespace: NAMESPACE,
      targetServiceName: serviceName,
      isOutputEnabled: true,
      isInputEnabled: false,
      rabbitClient,
    });

    const messagesToSend = new Array(10).fill(null).map(() => ({ test: Math.random() }));
    const receivedMessages = [];

    communicator.addOutputListener((ctx) => {
      receivedMessages.push(ctx.data);
    });

    await service.start();
    await communicator.start();

    createdQueues.push(service.outputQueueName);

    await Promise.all(
      messagesToSend.map(msg => service.send(msg)),
    );

    const areMessagesReceivedByCommunicator = await new Promise((resolve) => {
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

    expect(areMessagesReceivedByCommunicator).to.be.equal(true);
  });

  it('sends messages to service\'s input queue', async () => {
    const serviceName = 'service-4';

    const service = new Service({
      namespace: NAMESPACE,
      name: serviceName,
      isOutputEnabled: false,
      isInputEnabled: true,
      rabbitClient,
    });

    const communicator = new Communicator({
      namespace: NAMESPACE,
      targetServiceName: serviceName,
      isOutputEnabled: false,
      isInputEnabled: true,
      rabbitClient,
    });

    const messagesToSend = new Array(100).fill(null).map(() => ({ test: Math.random() }));
    const receivedMessages = [];

    service.addInputListener((ctx) => {
      receivedMessages.push(ctx.data);
    });

    await service.start();
    await communicator.start();

    createdQueues.push(service.inputQueueName);

    await Promise.all(
      messagesToSend.map(msg => communicator.send(msg)),
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

  it('requeues messages to service\'s output queue on listener\'s exceptions', async () => {
    const serviceName = 'service-5';

    const service = new Service({
      namespace: NAMESPACE,
      name: serviceName,
      isOutputEnabled: true,
      isInputEnabled: false,
      rabbitClient,
    });

    const communicator = new Communicator({
      namespace: NAMESPACE,
      targetServiceName: serviceName,
      isOutputEnabled: true,
      isInputEnabled: false,
      rabbitClient,
    });

    const messagesToSend = new Array(3).fill(null).map(() => ({ test: Math.random() }));
    const receivedMessages = [];
    const receivedRequeuedMessages = [];

    communicator.addOutputListener(({ data }) => {
      if (receivedMessages.some(receivedItem => receivedItem.test === data.test)) {
        receivedRequeuedMessages.push(data);
      } else {
        receivedMessages.push(data);

        throw new Error('Communicator test exception');
      }
    });

    await service.start();
    await communicator.start();

    createdQueues.push(service.outputQueueName);

    await Promise.all(
      messagesToSend.map(msg => service.send(msg)),
    );

    const areMessagesReceivedByCommunicator = await new Promise((resolve) => {
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

    expect(areMessagesReceivedByCommunicator).to.be.equal(true);
  });

  it('passes itself to service\'s output listener and allows to send messages to service\'s input queue using it', async () => {
    const serviceName = 'service-6';

    const service = new Service({
      namespace: NAMESPACE,
      name: serviceName,
      isOutputEnabled: true,
      isInputEnabled: true,
      rabbitClient,
    });

    const communicator = new Communicator({
      namespace: NAMESPACE,
      targetServiceName: serviceName,
      isOutputEnabled: true,
      isInputEnabled: true,
      rabbitClient,
    });

    const messagesToSend = new Array(10).fill(null).map(() => ({ test: Math.random() }));
    const receivedMessages = [];

    service.addInputListener((ctx) => {
      receivedMessages.push(ctx.data);
    });

    communicator.addOutputListener(async (ctx) => {
      // trigger received
      await Promise.all(
        messagesToSend.map(msg => ctx.reply(msg)),
      );
    });

    await service.start();
    await communicator.start();

    createdQueues.push(service.inputQueueName, service.outputQueueName);

    // trigger message
    await service.send({ foo: 'bar' });

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

  it('allows to pass custom metadata to use it in every service input message', async () => {
    const serviceName = 'service-10';

    const communicatorMetadata = {
      num: 1,
      boo: true,
      str: 'foo',
    };

    const service = new Service({
      namespace: NAMESPACE,
      name: serviceName,
      isOutputEnabled: false,
      isInputEnabled: true,
      rabbitClient,
    });

    const communicator = new Communicator({
      namespace: NAMESPACE,
      targetServiceName: serviceName,
      isOutputEnabled: false,
      isInputEnabled: true,
      metadata: communicatorMetadata,
      rabbitClient,
    });

    let receivedMessageMetadata;

    service.addInputListener((ctx) => {
      receivedMessageMetadata = ctx.metadata;
    });

    await service.start();
    await communicator.start();

    createdQueues.push(service.inputQueueName);

    communicator.send({ foo: 'bar' });

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

    expect(receivedMessageMetadata).to.be.eql(communicatorMetadata);
  });
});
