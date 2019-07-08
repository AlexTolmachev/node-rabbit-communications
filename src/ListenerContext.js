module.exports = class ListenerContext {
  constructor({
    rabbitMessage,
    rabbitChannel,
    communicator,
    metadata,
    service,
    manager,
    data,
  }) {
    this.communicator = communicator;
    this.message = rabbitMessage;
    this.channel = rabbitChannel;
    this.metadata = metadata;
    this.service = service;
    this.manager = manager;
    this.data = data;

    const entityInstance = service || communicator;

    if (metadata.ask) {
      // service addAskListener callback case
      this.reply = (replyData, additionalMetadata) => entityInstance.send.call(
        entityInstance,
        replyData,
        {
          ...additionalMetadata,
          isReplyTo: metadata.messageId,
        },
      );
    } else {
      // regular "reply" with no mapping
      this.reply = entityInstance.send.bind(entityInstance);
    }
  }
};
