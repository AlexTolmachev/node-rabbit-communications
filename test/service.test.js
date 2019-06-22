const { expect } = require('chai');
const { Service, RabbitClient } = require('../src');

const { RABBIT_URL } = process.env;

describe('Service (allows to exchange messages with it in both directions)', () => {
  const NAMESPACE = 'namespace-1';

  const createdQueues = [];
  let rabbitClient;

  before(() => {
    rabbitClient = new RabbitClient(RABBIT_URL, {
      appName: NAMESPACE,
      json: true,
    });
  });

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

    createdQueues.push(inputQueueName);
    createdQueues.push(outputQueueName);

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

    createdQueues.push(inputService.inputQueueName);
    createdQueues.push(outputService.outputQueueName);

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

    const messagesToSend = [{ test: 1 }, { test: 2 }, { test: 3 }];
    const receivedMessages = [];

    service.addInputListener((data) => {
      receivedMessages.push(data);
    });

    await service.start();

    createdQueues.push(service.inputQueueName);

    await Promise.all(
      messagesToSend.map(msg => testChannel.sendToQueue(service.inputQueueName, msg)),
    );

    const areMessagesReceivedByService = await new Promise((resolve) => {
      setTimeout(() => resolve(false), 5e3);

      setInterval(() => {
        if (receivedMessages.length === messagesToSend.length) {
          const areAllMessagesReceived = messagesToSend.map(
            item => receivedMessages.some(receivedItem => receivedItem.test === item.test),
          ).every(Boolean);

          if (areAllMessagesReceived) {
            resolve(true);
          }
        }
      }, 100);
    });

    expect(areMessagesReceivedByService).to.be.equal(true);
  });

  it('sends messages to output queue', async () => {

  });

  it('requeues message to input queue on listener\'s exceptions', async () => {

  });

  it('passes itself to input listener and allows to send output messages using it', async () => {

  });
});
