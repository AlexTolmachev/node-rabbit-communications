const { expect } = require('chai');
const { Service, RabbitClient } = require('../src');

const { RABBIT_URL } = process.env;

describe('Service (allows to exchange messages with it in both directions)', () => {
  before(() => {

  });

  after(async () => {

  });

  it('start method throws exception if input channel is enabled but no listener provided', async () => {

  });

  it('creates input and output queues', async () => {

  });

  it('allows to turn off input or output functionality', async () => {

  });

  it('calls listener on input queue messages', async () => {

  });

  it('sends messages to output queue', async () => {

  });

  it('requeues message to input queue on listener\'s exceptions', async () => {

  });

  it('passes itself to input listener and allows to send output messages using it', async () => {

  });
});
