const bodyParser = require('body-parser');
const jsonParser = bodyParser.json();

const { 
  mainConfig,
  UpdateMainConfig,
 } = require("../../Database.cjs");
const { db_collections } = require("../../BaseDatabase.cjs");
const { mainController } = require("../../MainController.cjs");

function sendError(/** @type {import('express-serve-static-core').Response}*/res, /**@type {Error|string|object}*/error)
{
  res.status(500).send(error.toString ? String(error) : JSON.stringify(error))
}

function processResult(/** @type {import('express-serve-static-core').Response} */res, /** @type {Promise<any>} */promise)
{
  promise.then((info)=>res.status(200).send(JSON.stringify(info)))
    .catch((error)=>{
      res.status(500).send(error.toString ? String(error) : JSON.stringify(error))
    });
}

function addRoutes(/** @type {import('express-serve-static-core').Express} */app)
{
  app.post('/api/docker/containers/list', jsonParser, async (req, res)=>{
    try {
      /** @type {ApiDockerContainerAction} */
      let request = req.body;
      let data = await mainController.getDocker(request.dockerId).listContainers();
      res.status(200).send(JSON.stringify(data));
    } catch (error) {
      console.error(error);
      res.status(500).send(JSON.stringify(error));
    }
  });
  
  app.post('/api/docker/container/:action', jsonParser, async (req, res)=>{
    try {
      /** @type {ApiDockerContainerAction} */
      let request = req.body;
      let container = mainController.getDocker(request.dockerId).getContainer(request.containerId);
      /** @type {any} */
      let data = null;
      switch(req.params.action) {
        case "stop":
          data = await container.stop({signal: request.params?.signal, t: request.params?.timeoutSec});
          break;
        case "start":
          data = await container.start();
          break;
        case "kill":
          data = await container.kill();
          break;
        case "inspect":
          data = await container.inspect();
          break;
        case "cmd":
          data = await container.exec({Cmd: request.params?.cmd, AttachStderr: true, AttachStdout: true});
          break;
        case "logs":
          data = await container.logs({stderr: request.params?.stderr, stdout: request.params?.stdout, timestamps: true, tail: request.params?.tail});
          break;
        default:
          return res.sendStatus(404);
      }
      res.status(200).send(JSON.stringify(data));
    } catch (error) {
      console.error(error);
      res.status(500).send(JSON.stringify(error));
    }
  });

  app.post('/api/controller/bundle/create', jsonParser, (req, res)=>{
    try {
      mainController.createBundle(req.body, processResult.bind(this, res));
    } catch (error) {
      console.error(error);
      res.status(500).send(JSON.stringify(error));
    }
  });
  
  app.post('/api/controller/bundle/deploy', jsonParser, (req, res)=>{
    try {
      mainController.deployBundle(req.body)
        .then((deployedInfo)=>res.status(200).send(JSON.stringify(deployedInfo)))
        .catch(sendError.bind(this, res));
    } catch (error) {
      console.error(error);
      res.status(500).send(JSON.stringify(error));
    }
  });
  
  app.post('/api/controller/rpc', jsonParser, (req, res)=>{
    try {
      /** @type {{fname: string, params?: object}} */
      let request = req.body;
      /** @type {Promise<any>|undefined} */
      //@ts-ignore
      let result = mainController[request.fname](request.params);
      if (result?.then) {
        result.then((data)=>res.status(200).send(data))
          .catch(sendError.bind(this, res));
      } else {
        res.sendStatus(200);
      }
    } catch (error) {
      console.error(error);
      res.status(500).send(JSON.stringify(error));
    }
  });
  
  app.post('/api/docker/rpc', jsonParser, (req, res)=>{
    try {
      /** @type {{dockerId: string, fname: string, params?: object}} */
      let request = req.body;
      /** @type {Promise<any>|undefined} */
      //@ts-ignore
      let result = mainController.getDocker(request.dockerId)[request.fname](request.params);
      if (result?.then) {
        result.then((data)=>{
            // console.log("rpc", data);
            res.status(200).send(data)})
          .catch(sendError.bind(this, res));
      } else {
        res.sendStatus(200);
      }
    } catch (error) {
      console.error(error);
      res.status(500).send(JSON.stringify(error));
    }
  });
  
  app.post('/api/docker/pack/remove', jsonParser, async (req, res)=>{
    try {
      /** @type {ApiDockerPackActions} */
      let request = req.body;
      await mainController.getDocker(request.dockerId).removePack(request.packId);
      res.sendStatus(200);
    } catch (error) {
      console.error(error);
      res.status(500).send(JSON.stringify(error));
    }
  });
  
  app.post('/api/docker/clearSharedResources', jsonParser, async (req, res)=>{
    try {
      /** @type {ApiDockerPackActions} */
      let request = req.body;
      await mainController.getDocker(request.dockerId).clearSharedResources();
      res.sendStatus(200);
    } catch (error) {
      console.error(error);
      res.status(500).send(JSON.stringify(error));
    }
  });
  
  app.post('/api/docker/pack/upgrade', jsonParser, async (req, res)=>{
    try {
      /** @type {ApiDockerPackActions & UpgradeDeployedRequest} */
      let request = req.body;
      await mainController.getDocker(request.dockerId).upgradePack(request);
      res.sendStatus(200);
    } catch (error) {
      console.error(error);
      res.status(500).send(JSON.stringify(error));
    }
  });
  
  app.post('/api/docker/pack/ping', jsonParser, async (req, res)=>{
    try {
      /** @type {ApiDockerPackActions} */
      let request = req.body;
      await mainController.getDocker(request.dockerId).pingPack(request.packId);
      res.sendStatus(200);
    } catch (error) {
      console.error(error);
      res.status(500).send(JSON.stringify(error));
    }
  });
  
  app.post('/api/db/:dbName/item/save', jsonParser, async (req, res)=>{
    try {
      let dbName = req.params.dbName;
      if (!db_collections[dbName]) return res.sendStatus(404);
      if (!req.body.id) return res.sendStatus(400);
      await db_collections[dbName].save(req.body);
      res.sendStatus(200);
    } catch (error) {
      console.error(error);
      res.status(500).send(JSON.stringify(error));
    }
  });
  
  app.post("/api/adminAccessKey", jsonParser, (req, res)=>{
    try {
      let request = req.body;
      if (request.currentKey !== mainConfig.adminAccessKey) return res.sendStatus(401);
      if (request.newKey !== undefined) {
        return mainConfig.save({adminAccessKey: request.newKey})
          .then(()=>res.sendStatus(200))
          .catch(()=>res.sendStatus(500));
      }
      res.sendStatus(200);
    } catch (error) {
      console.error(error);
      res.sendStatus(500);
    }
  });
  
  app.post("/api/mainConfig/save", jsonParser, (req, res)=>{
    try {
      let request = req.body;
      if (request.currentKey !== mainConfig.adminAccessKey) return res.sendStatus(401);
      if (request.params !== undefined) {
        delete request.params.adminAccessKey;
        return UpdateMainConfig(request.params)
          .then(()=>res.sendStatus(200))
          .catch(()=>res.sendStatus(500));
      }
      res.sendStatus(200);
    } catch (error) {
      console.error(error);
      res.sendStatus(500);
    }
  });
  
  app.delete("/api/restart", (req, res)=>{
    res.sendStatus(200)
    setTimeout(()=>process.exit(1), 1000);
  })
}

module.exports = addRoutes;