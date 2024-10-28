const MsgLvl = {
  critical: "critical",
  error: "error",
  warning: "warning",
}

const NotificationLogPrefix = "[NotificationMessage]:";

class BaseNotifications
{
  /** @param {string} name */
  constructor(name, limit = 100)
  {
    this.name = name;
    /** @type {LogMessage[]} */
    this.items = [];
    this.limit = limit;
    /** @type {LogMessagesCallback[]} */
    this.callbacks = [];
    this.lastMsgId = 0;
    this.idPrefix = `${this.name}_${+new Date()}_`;
  }
  getNextMsgId()
  {
    return this.idPrefix + this.lastMsgId++;
  }
  subscribeNotifications(/** @type {LogMessagesCallback} */callback)
  {
    this.callbacks.push(callback);
  }
  /** @param {string} message */
  postCritical(message, debug=undefined){this.postMessage({severity: MsgLvl.critical, message, debug});}
  /** @param {string} message */
  postError(message, debug=undefined){this.postMessage({severity: MsgLvl.error, message, debug});}
  /** @param {string} message */
  postWarning (message, debug=undefined){this.postMessage({severity: MsgLvl.warning, message, debug});}
  postMessage(/** @type {NotificationMessage}*/_item)
  {
    let item = {
      ..._item,
      id: this.getNextMsgId(),
      timestamp: new Date().toISOString(),
      component: this.name,
      type: "log.message",
    }
    if (item.severity == MsgLvl.critical || item.severity == MsgLvl.error) {
      console.error(NotificationLogPrefix, item);
      if (item.debug?.stack) {
        console.log("Stack:\n", item.debug.stack, "\n\n");
      }
    } else if (item.severity == MsgLvl.warning) {
      console.warn(NotificationLogPrefix, item);
    } else {
      console.log(NotificationLogPrefix, item);
    }
    this.items.push(item);
    if (this.items.length > this.limit) {
      this.items.shift();
    }
    this.callbacks.forEach(callback=>callback([item]))
  }
}

const providers = {
  database: new BaseNotifications("database"),
  docker: new BaseNotifications("docker"),
  pm: new BaseNotifications("pm"),
  webServer: new BaseNotifications("webServer"),
};

module.exports = {
  MsgLvl,
  providers,
  NotificationLogPrefix,
}