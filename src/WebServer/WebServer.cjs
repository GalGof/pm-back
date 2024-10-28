
const app = require('express')();
app.use(require('cors')());
require("./parts/routes.cjs")(app);

const server = require('http').createServer(app);
const { initWebsockets, wsEmit } = require("./parts/websockets.cjs");
initWebsockets(server);

let idPrefix = `log_${+new Date()}_`;
let lastMsgId = 0;
function getNextMsgId()
{
  return idPrefix + lastMsgId++;
}

const { NotificationLogPrefix, } = require("../Notifications.cjs");
/** @type {("log"|"debug"|"error"|"info"|"trace"|"warn")[]} */
const logCalls = ["log", "debug", "error", "info", "trace", "warn"];
for (const logCall of logCalls) {
  let orgCall = console[logCall];
  console[logCall] = (...args)=>{
    orgCall(...args);
    if (args?.[0] === NotificationLogPrefix) return;
    let nArgs = [];
    for (let arg of args) {
      if (arg?.toString) {
        nArgs.push(String(arg))
        if (arg.stack) nArgs.push(arg.stack)
      } else {
        nArgs.push(JSON.stringify(arg, null, 2));
      }
    }
    /** @type {LogMessage} */
    let msg = {
      id: getNextMsgId(),
      component: "log",
      severity: logCall,
      timestamp: new Date().toISOString(),
      message: nArgs.join('\n'),
    };
    wsEmit({type: "log.message", operation: "log.messages", data: [msg]});
  }
}

function StartServer(/** @type {number} */port)
{
  server.listen(port, console.log.bind(console, 'http server started', port));
}

module.exports = {
  StartServer,
}