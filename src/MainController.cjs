const { DockerWrapper } = require("puppet-masters/DockerWrapper");
const { dockerEnginesInfo, deployedInfo } = require("./Database.cjs");
const { BaseLiveQueue } = require("./BaseDatabase.cjs");
const { providers } = require("./Notifications.cjs");
const { c_blank } = require("./common/callbackUtils.cjs");

const BUILDER_LABEL = "dockerBuilder";

class MainController
{
  constructor()
  {
    /** @type {BaseLiveQueue<DeployQueueItem>} */
    this._deployQueue = new BaseLiveQueue("deployQueue");
    /** @type {BaseLiveQueue<BuildBundleQueueItem>} */
    this._buildBundleQueue = new BaseLiveQueue("buildBundleQueue");
    /** @type {(data?: object)=>void} */
    this._telemetryCallback = c_blank;
  }
  async init()
  {
    /** @type {{[engineId:string]: object}} */
    this.enginesTelemetry = {};
    /** @type {DockerWrapper[]} */
    this._dockers = dockerEnginesInfo.getItems().map(data=>new DockerWrapper({data, onTelemetry: this.onEngineTelemetry.bind(this, data.id)}));
    dockerEnginesInfo.subscribeOnItemChanges((msg)=>{
      if (msg.operation == "db.change") {
        let item = this._dockers.find(it=>it.mdata.id == msg.item.id);
        if (!item) {
          item = new DockerWrapper({data: msg.item, onTelemetry: this.onEngineTelemetry.bind(this, msg.item.id)});
          this._dockers.push(item);
        } 
        // item.reInit(msg.item);
      } else if (msg.operation == "db.delete") {
        let idx = this._dockers.findIndex(it=>it.mdata.id == msg.itemId);
        if (idx >= 0) {
          let removedDocker = this._dockers.splice(idx, 1)[0];
          if (removedDocker) {
            removedDocker.destroy();
          }
        }
      }
    });
    deployedInfo.subscribeOnItemChanges((msg)=>{
      if (msg.operation == "db.delete") {
        this.deployQueueTick();
      }
    })
    this.telemetryTick();
    // setTimeout(()=>this.telemetryTick(), 60000);
  }
  get _initializedDockers()
  {
    return this._dockers.filter(it=>it.initialized);
  }
  get _activeDockers()
  {
    return this._dockers.filter(it=>it.initialized && !it.mdata.disabled);
  }
  getDocker(/** @type {string}*/id)
  {
    let docker = this._initializedDockers.find(it=>it.mdata.id == id);
    if (!docker) throw new Error(`Docker(${id}) not found`);
    return docker;
  }
  deployQueueTick()
  {
    let queueItems = this._deployQueue.getItems();
    if (!queueItems[0]) return;
    let toDelete = [];
    for (let it of queueItems) {
      try {
        const {request, callback, id} = it;
        let maxClones = 1 + (request.pcidsToAdd ? Math.max(...Object.values(request.pcidsToAdd)) : 0);
        let dockers = this._activeDockers
          .filter(it=>{
            return !it.mdata.disabled
              && it._ipList.size >= maxClones
              && (!request.bananaLoad || (request.bananaLoad <= (it.mdata.bananasLimit - it.bananaUsage)))
              && request.dockerEngineFilters.reduce((p, c)=>p && it.mdata.labels.includes(c), true)
          });
        if (!dockers.length) {
          it.missCount++;
          this._deployQueue.save(it);
          continue;
        }
        let targetDocker = dockers.sort((q, w)=>q.deployChangeQueueLength - w.deployChangeQueueLength)[0];
        callback(targetDocker.addPack(request));
        toDelete.push(id);
      } catch (error) {
        providers.pm.postCritical("[deployQueueTick]: exception", error);
      }
    }
    for (let id of toDelete) {
      this._deployQueue.delete(id);
    }
  }
  async createBundleTick()
  {
    let item = this._buildBundleQueue.getItems()[0];
    if (!item || item.buildInProgress) return;
    let docker = this._activeDockers.find(it=>it.mdata.labels.includes(BUILDER_LABEL) && !it.mdata.disabled);
    if (!docker) {
      item.missCount++;
      this._buildBundleQueue.save(item);
      setTimeout(()=>this.createBundleTick(), 60000);
      return;
    }
    item.buildInProgress = true;
    this._buildBundleQueue.save(item);
    let result = docker.createBundle(item.request);
    item.callback(result);
    result.catch(c_blank).finally(()=>{
      this._buildBundleQueue.delete(item.id);
      setTimeout(()=>this.createBundleTick(), 0);
    })
  }
  async createBundle(/** @type {BuildBundleRequest} */ request, /** @type {(res: Promise<BundleInfo>)=>void}*/ callback)
  {
    this._buildBundleQueue.save({
      request,
      addTime: new Date().toISOString(),
      id: String(this._buildBundleQueue.getNextId()),
      lastSave: 0,
      missCount: 0,
      callback,
      buildInProgress: false,
    });
    this.createBundleTick();
  }
  /** @return {Promise<DeployedInfo>}*/
  deployBundle(/** @type {DeployBundleRequest}*/ request)
  {
    return new Promise(resolve=>{
      this._deployQueue.save({request, callback: resolve, id: String(this._deployQueue.getNextId()), lastSave: 0, addTime: new Date().toISOString(), missCount: 0});
      this.deployQueueTick();
    })
  }
  subscribeOnQueues(/** @type {(data?: object)=>void}*/callback)
  {
    this._deployQueue.subscribeOnItemChanges(callback);
    this._buildBundleQueue.subscribeOnItemChanges(callback);
  }
  setTelemetryCallback(/** @type {(data?: object)=>void}*/callback)
  {
    this._telemetryCallback = callback;
  }
  onEngineTelemetry(/** @type {string}*/engineId, /** @type {object}*/data)
  {
    this.enginesTelemetry[engineId] = {
      ...(this.enginesTelemetry[engineId] || {}),
      ...data
    }
    this._telemetryCallback({engines: this.enginesTelemetry});
  }
  async telemetryTick()
  {
    try {
      // let promises = [];
      // for (let docker of this._initializedDockers) {
      //   const engineId = docker.mdata.id;
      //   if (!this.enginesTelemetry[engineId]) this.enginesTelemetry[engineId] = {};
      //   promises.push(docker.ping()
      //     .then(()=>this.enginesTelemetry[engineId].pong = true)
      //     .catch(()=>this.enginesTelemetry[engineId].pong = false));
      // }
      // await Promise.all(promises);
      this._telemetryCallback({engines: this.enginesTelemetry});
    } catch (error) {
      console.error("[telemetryTick]:", error);
    }
    setTimeout(()=>this.telemetryTick(), 60000);
  }
  removeDeployQueueItem(/** @type {string}*/itemId)
  {
    let item = this._deployQueue.getItems().find(it=>it.id == itemId);
    item.callback(Promise.reject("removed from queue"));
    this._deployQueue.delete(itemId);
  }
}

const mainController = new MainController();

module.exports = {
  mainController,
}