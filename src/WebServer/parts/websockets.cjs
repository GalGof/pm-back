const WSServer = require('ws').Server;
const http = require('http');

const { db_collections } = require("../../BaseDatabase.cjs");
const { 
  dockerEnginesInfo,
  dockerRegistriesInfo,
  deployedInfo,
  bundlesInfo,
  buildersInfo,
  sharedDataInfo,
} = require("../../Database.cjs");
const { providers, MsgLvl, NotificationLogPrefix, } = require("../../Notifications.cjs");
const { mainController } = require("../../MainController.cjs");

/**
 * @param {http.Server} expressServer 
 * @param {string} path 
 */
function makeWsServer(expressServer, path) {
  /** @type {WSServer} */
  const websocketServer = new WSServer({ noServer: true, path, });

  expressServer.on("upgrade", function(request, socket, head) {
    // console.log({upgrade: request.url})
    if (request.url !== path) return;
    websocketServer.handleUpgrade(request, socket, head, (websocket) => {
      websocketServer.emit("connection", websocket, request);
    });
  });

  return websocketServer;
};
/** @type {WSServer} */
let wsServer = undefined;
/** @type {WSServer} */
let containerWsServer = undefined;

function wsEmit(/** @type {string|object}*/obj)
{
  if (!wsServer) {
    throw new Error("data send attempt before init finished")
  };
  try {
    let data = typeof(obj) == 'string' ? obj : JSON.stringify(obj);
    wsServer.clients.forEach(q=>q.send(data));
  } catch (error) {
    providers.webServer.postMessage({severity: MsgLvl.critical, message: "wsEmit exception", debug: error});
  }
}

function initLiveExecWs(/** @type {http.Server}*/server)
{
  containerWsServer = makeWsServer(server, "/websockets/container/exec");
  containerWsServer.on("connection", (socket, request)=>{
    const cb = (/** @type {import('ws').MessageEvent}*/msg)=>{
      try {
        const text = msg.data.toString();
        console.log("containerWsServer", text);
        let data = JSON.parse(text);
        mainController
          .getDocker(data.dockerId)
          .liveExecContainer({...data, webSocket: socket})
          .catch((error)=>socket.close(4003, String(error).slice(0, 123)));
      } catch (error) {
        socket.close(4004, String(error).slice(0, 123));
      }
      socket.removeEventListener("message", cb);
    };
    socket.addEventListener("message", cb);
  })
}

/** @type {{[x: string]: {timestamp: number, msg: string}}} */
const dbInitCache = {};
/** @type {{type: string, data: any}} */
var mainControllerLastTelemetry = undefined;

function initApiWs(/** @type {http.Server}*/server)
{
  wsServer = makeWsServer(server, "/websockets");
  wsServer.on('connection', async function(socket, request) {
    let clientId = request.socket.remoteAddress+":"+request.socket.remotePort;
    console.debug('Client connection', clientId, wsServer.clients.size);
    socket.on('message', async (rawdata, isBinary)=>{
      try {
        if (isBinary) throw new Error("Unexpected ws binary msg");
        let message = rawdata.toString();
        console.debug("ws message", message);
        let request = JSON.parse(message);
        // rest api bad for manual usage on web page as browser limits host to 6 simultanious requests..
        if (request.message == "rpc.call") {
          /** @type {WsRpcMessage} */
          let rpcCall = request;
          try {
            let target = null;
            if (rpcCall.target == "Docker") {
              target = mainController.getDocker(rpcCall.dockerId);
            } else
            if (rpcCall.target == "Controller") {
              target = mainController;
            } else
            if (rpcCall.target == "Database") {
              target = db_collections[rpcCall.dbName];
            } else {
              socket.send(JSON.stringify({rpcId: rpcCall.rpcId, error: "Bad target"}))
            }
            let mark = +new Date();
            //@ts-ignore
            let result = target[rpcCall.method](...(rpcCall.args || []));
            if (result?.then && result?.catch) {
              result = await result;
            }
            let responce = {rpcId: rpcCall.rpcId, result};
            let responseStr = JSON.stringify(responce, null, 2);
            socket.send(responseStr)
            console.debug("wsRpc >>>", responseStr, "\n", +new Date() - mark)
          } catch (error) {
            console.error("wsRpc error", error)
            socket.send(JSON.stringify({rpcId: rpcCall.rpcId, error: error instanceof Error ? String(error) : error}))
          }
          return;
        }
        if (request.message == "get.all.packs") {
          let cacheName = bundlesInfo.dbName + "_full";
          if (!dbInitCache[cacheName] || dbInitCache[cacheName].timestamp < bundlesInfo.lastChange) {
            let timestamp = +new Date();
            let packsAllData = bundlesInfo.getItems();
            dbInitCache[cacheName] = {
              timestamp,
              msg: JSON.stringify({type: "db.info", dbName: bundlesInfo.dbName, operation: "db.init", items: packsAllData.reverse()}),
            }
          }
          return socket.send(dbInitCache[cacheName].msg);
        }
        if (request.message == "log.subscribe") {
          Object.values(providers).forEach(it=>{
            socket.send(JSON.stringify({type: "log.message", operation: "log.messages", data: it.items}));
            it.subscribeNotifications((data)=>socket.send(JSON.stringify({type: "log.message", operation: "log.messages", data})));
          })
        }
      } catch (error) {
        providers.webServer.postMessage({severity: MsgLvl.critical, message: "ws client message exception", debug: error})
      }
    });
    socket.on('close', ()=>{
      console.debug("Client closed", clientId);
    });
    try {
      [
        dockerEnginesInfo,
        dockerRegistriesInfo,
        deployedInfo,
        buildersInfo,
        sharedDataInfo,
      ].forEach(it=>{
        let cacheName = it.dbName;
        if (!dbInitCache[cacheName] || dbInitCache[cacheName].timestamp < it.lastChange) {
          let timestamp = +new Date();
          let items = it.getItems();
          dbInitCache[cacheName] = {
            timestamp,
            msg: JSON.stringify({type: "db.info", dbName: it.dbName, operation: "db.init", items}),
          }
        }
        if (socket.readyState !== socket.OPEN) return;
        socket.send(dbInitCache[cacheName].msg);
      });
      [
        mainController._deployQueue,
        mainController._buildBundleQueue,
      ].forEach(it=>{
        let msg = {type: "db.info", dbName: it.dbName, operation: "db.init", items: it.getItems()};
        socket.send(JSON.stringify(msg));
      });
      {
        let cacheName = bundlesInfo.dbName + "_top";
        if (!dbInitCache[cacheName] || dbInitCache[cacheName].timestamp < bundlesInfo.lastChange) {
          let timestamp = +new Date();
          let packsAllData = bundlesInfo.getItems();
          let freshPacks = packsAllData.filter(q=>!q.persistent).slice(-100);
          let persistentPacks = packsAllData.filter(q=>q.persistent);
          dbInitCache[cacheName] = {
            timestamp,
            msg: JSON.stringify({type: "db.info", dbName: bundlesInfo.dbName, operation: "db.init", items: persistentPacks.concat(freshPacks).reverse()}),
          }
        }
        if (socket.readyState !== socket.OPEN) return;
        socket.send(dbInitCache[cacheName].msg);
      }
    } catch (error) {
      providers.webServer.postMessage({severity: MsgLvl.critical, message: "ws client db init exception", debug: error})
    }
    if (mainControllerLastTelemetry) {
      socket.send(JSON.stringify(mainControllerLastTelemetry));
    }
  });
}

function initWebsockets(/** @type {http.Server}*/server)
{
  initLiveExecWs(server);
  initApiWs(server)

  Object.values(db_collections).forEach((db)=>db.subscribeOnItemChanges(wsEmit));
  Object.values(providers).forEach(it=>it.subscribeNotifications(wsEmit));

  mainController.subscribeOnQueues(wsEmit)
  mainController.setTelemetryCallback((/** @type {any}*/data)=>{
    mainControllerLastTelemetry = {type: "mainController.telemetry", data};
    wsEmit(mainControllerLastTelemetry);
  })
}

module.exports = {
  initWebsockets,
  wsEmit,
};