const { expect } = require('chai');
const { Service, CommunicationsManager, RabbitClient } = require('../src');

const { RABBIT_URL } = process.env;

describe('CommunicationsManager (manages a pool of Communicators to interact with multiple services simultaneously. Core gateway functionality)', () => {
  const NAMESPACE = 'namespace-3';

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

  it('registers multiple communicators', async () => {
    const manager = new CommunicationsManager({
      namespace: NAMESPACE,
      rabbitClient,
    });

    manager.registerCommunicator('service-1', {
      isInputEnabled: true,
      isOutputEnabled: true,
    });

    manager.addOutputListener('service-1', () => {}); // first listener addition method

    manager.registerCommunicator(
      'service-2',
      {
        isInputEnabled: true,
        isOutputEnabled: true,
      },
      () => {}, // second listener addition method
    );

    await manager.start();

    const registeredCommunicators = Object.values(manager.communicatorMap);

    createdQueues.push(
      registeredCommunicators[0].inputQueueName,
      registeredCommunicators[0].outputQueueName,
      registeredCommunicators[1].inputQueueName,
      registeredCommunicators[1].outputQueueName,
    );

    expect(registeredCommunicators).to.have.lengthOf(2);

    expect(registeredCommunicators[0].inputChannel).not.to.be.equal(undefined);
    expect(registeredCommunicators[0].outputChannel).not.to.be.equal(undefined);
    expect(registeredCommunicators[1].inputChannel).not.to.be.equal(undefined);
    expect(registeredCommunicators[1].outputChannel).not.to.be.equal(undefined);
  });

  it('allows to apply async (koa-style) middleware for all incoming messages', async () => {
    const serviceName = 'service-3';

    const manager = new CommunicationsManager({
      namespace: NAMESPACE,
      rabbitClient,
    });

    const service = new Service({
      namespace: NAMESPACE,
      name: serviceName,
      isOutputEnabled: true,
      isInputEnabled: false,
      rabbitClient,
    });

    manager.registerCommunicator(serviceName, {
      isOutputEnabled: true,
      isInputEnabled: false,
    });

    const middlewareTags = {
      ROOT_1: 'root 1',
      ROOT_2: 'root 2',
      ROOT_3: 'root 3',
      SPECIFIC_1: 'specific 1',
      SPECIFIC_2: 'specific 2',
      SPECIFIC_3: 'specific 3',
      SPECIFIC_4: 'specific 4',
      SPECIFIC_5: 'specific 5',
      SPECIFIC_6: 'specific 6',
      CONTROLLER: 'controller',
      ROOT_REVERSE_FLOW: 'root reverse flow',
    };

    const calledMiddlewareTags = [];

    manager.applyMiddleware(async (ctx, next) => {
      await next();

      calledMiddlewareTags.push(middlewareTags.ROOT_REVERSE_FLOW);
    });

    manager.applyMiddleware(async (ctx, next) => {
      calledMiddlewareTags.push(middlewareTags.ROOT_1);

      await next();
    });

    manager.applyMiddleware([
      async (ctx, next) => {
        calledMiddlewareTags.push(middlewareTags.ROOT_2);

        await next();
      },
      async (ctx, next) => {
        calledMiddlewareTags.push(middlewareTags.ROOT_3);

        await next();
      },
    ]);

    manager.applyMiddleware(serviceName, async (ctx, next) => {
      calledMiddlewareTags.push(middlewareTags.SPECIFIC_1);

      await next();
    });

    manager.applyMiddleware([serviceName], async (ctx, next) => {
      calledMiddlewareTags.push(middlewareTags.SPECIFIC_2);

      await next();
    });

    manager.applyMiddleware(serviceName, [
      async (ctx, next) => {
        calledMiddlewareTags.push(middlewareTags.SPECIFIC_3);

        await next();
      },
      async (ctx, next) => {
        calledMiddlewareTags.push(middlewareTags.SPECIFIC_4);

        await next();
      },
    ]);

    manager.applyMiddleware([serviceName], [
      async (ctx, next) => {
        calledMiddlewareTags.push(middlewareTags.SPECIFIC_5);

        await next();
      },
      async (ctx, next) => {
        calledMiddlewareTags.push(middlewareTags.SPECIFIC_6);

        await next();
      },
    ]);

    manager.addOutputListener(serviceName, () => {
      calledMiddlewareTags.push(middlewareTags.CONTROLLER);
    });

    await service.start();
    await manager.start();

    createdQueues.push(service.outputQueueName);

    await service.send({ trigger: 'message' });

    const middlewareTagsList = Object.values(middlewareTags);

    const isMiddlewareCalledProperly = await new Promise((resolve) => {
      const timeoutId = setTimeout(() => resolve(false), 2e3);

      const intervalId = setInterval(() => {
        if (calledMiddlewareTags.length !== middlewareTagsList.length) {
          return;
        }

        const result = JSON.stringify(middlewareTagsList) === JSON.stringify(calledMiddlewareTags);

        if (result) {
          clearTimeout(timeoutId);
          clearInterval(intervalId);

          resolve(true);
        }
      });
    });

    expect(isMiddlewareCalledProperly).to.be.equal(true);
  });

  it('allows to send messages via specific Communicator (pass single Service name when sending)', async () => {
    const serviceName = 'service-4';

    const service = new Service({
      namespace: NAMESPACE,
      name: serviceName,
      isInputEnabled: true,
      isOutputEnabled: false,
      rabbitClient,
    });

    const manager = new CommunicationsManager({
      namespace: NAMESPACE,
      rabbitClient,
    });

    manager.registerCommunicator(serviceName, {
      isInputEnabled: true,
      isOutputEnabled: false,
    });

    const messagesToSend = new Array(100).fill(null).map(() => ({ test: Math.random() }));
    const receivedMessages = [];

    service.addInputListener((ctx) => {
      receivedMessages.push(ctx.data);
    });

    await service.start();
    await manager.start();

    createdQueues.push(service.inputQueueName);

    await Promise.all(
      messagesToSend.map(msg => manager.send(serviceName, msg)),
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

        if (areAllMessagesReceived) {
          clearTimeout(timeoutId);
          clearInterval(intervalId);

          resolve(true);
        }
      }, 100);
    });

    expect(areMessagesReceivedByService).to.be.equal(true);
  });

  it('allows to broadcast same messages via multiple Communicators (pass array of Service names when sending)', async () => {
    const serviceName1 = 'service-5';
    const serviceName2 = 'service-6';

    const service1 = new Service({
      namespace: NAMESPACE,
      name: serviceName1,
      isInputEnabled: true,
      isOutputEnabled: false,
      rabbitClient,
    });

    const service2 = new Service({
      namespace: NAMESPACE,
      name: serviceName2,
      isInputEnabled: true,
      isOutputEnabled: false,
      rabbitClient,
    });

    const manager = new CommunicationsManager({
      namespace: NAMESPACE,
      rabbitClient,
    });

    manager.registerCommunicator(serviceName1, {
      isInputEnabled: true,
      isOutputEnabled: false,
    });

    manager.registerCommunicator(serviceName2, {
      isInputEnabled: true,
      isOutputEnabled: false,
    });

    const messagesToSend = new Array(100).fill(null).map(() => ({ test: Math.random() }));
    const receivedMessages1 = [];
    const receivedMessages2 = [];

    service1.addInputListener((ctx) => {
      receivedMessages1.push(ctx.data);
    });

    service2.addInputListener((ctx) => {
      receivedMessages2.push(ctx.data);
    });

    await service1.start();
    await service2.start();
    await manager.start();

    createdQueues.push(service1.inputQueueName, service2.inputQueueName);

    await Promise.all(
      messagesToSend.map(msg => manager.broadcast(msg)),
    );

    const areMessagesReceivedByService = await new Promise((resolve) => {
      const timeoutId = setTimeout(() => resolve(false), 2e3);

      const intervalId = setInterval(() => {
        if (receivedMessages1.length !== messagesToSend.length) {
          return;
        }

        if (receivedMessages2.length !== messagesToSend.length) {
          return;
        }

        const areAllMessagesReceived1 = messagesToSend.map(
          item => receivedMessages1.some(receivedItem => receivedItem.test === item.test),
        ).every(Boolean);

        const areAllMessagesReceived2 = messagesToSend.map(
          item => receivedMessages2.some(receivedItem => receivedItem.test === item.test),
        ).every(Boolean);

        if (areAllMessagesReceived1 && areAllMessagesReceived2) {
          clearTimeout(timeoutId);
          clearInterval(intervalId);

          resolve(true);
        }
      }, 100);
    });

    expect(areMessagesReceivedByService).to.be.equal(true);
  });
});
