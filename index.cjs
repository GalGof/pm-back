['SIGINT', 'SIGTERM'].forEach(function (signal) {
  process.on(signal, function () {
    process.exit(0);
  });
});

process.on('uncaughtException', function (err) {
  console.error("uncaughtException 1:", err);
  // console.error("uncaughtException 2:", err.message, err.stack);
  process.exit(1);
});

const webServerPort = process.env.PORT ? +process.env.PORT : 4002;

(async function Init()
{
  const {initLog} = require("./src/log.cjs");
  await initLog();

  const {initDatabase} = require("./src/Database.cjs");
  await initDatabase();

  const {StartServer} = require("puppet-masters/WebServer");
  const {mainController} = require("./src/MainController.cjs");
  mainController
    .init()
    .then(()=>{
      StartServer(webServerPort);
    })
    .catch(err=>{
      console.error("critical init error", err);
      process.exit(2);
    });
})();

