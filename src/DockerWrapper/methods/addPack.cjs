const { deployedInfo, bundlesInfo, buildersInfo } = require("../../Database.cjs");
const { providers } = require("../../Notifications.cjs");
const { c_blank } = require("../../common/callbackUtils.cjs");

/**
 * @this {import('..').DockerWrapper}
 * @param {DeployBundleRequest} packRequest 
 * @param {DeployedInfo} packInfo 
 * @returns 
 */
async function _addPack(/** @type {DeployBundleRequest}*/ packRequest, /** @type {DeployedInfo} */ packInfo)
{
  this.logger.log("[_addPack]", {deployedId: packInfo.id});
  let bundleInfo = bundlesInfo.getItems().find(it=>it.id == packRequest.bundleId);
  if (!bundleInfo) throw new Error(`Pack(${packRequest.bundleId}) not found`);
  let builderInfo = buildersInfo.getItems().find(it=>it.id == bundleInfo.builderId)
  if (!builderInfo) throw new Error(`Builder(${bundleInfo.builderId}) not found`);
  await deployedInfo.save(packInfo);
  for (let it of bundleInfo.imagesToDeploy) {
    let pcid = it.pcid;
    let imageDeployInfo = it;
    let overrideBundleId = packRequest.overrides?.[pcid]?.imageFromBundleId;
    if (overrideBundleId) {
      let otherBundleInfo = bundlesInfo.getItems().find(it2=>it2.id == overrideBundleId);
      if (!otherBundleInfo) throw new Error(`Pack(${overrideBundleId}) not found`);
      imageDeployInfo = otherBundleInfo.imagesToDeploy.find(it2=>it2.pcid == pcid);
      if (!imageDeployInfo) throw new Error(`No (${pcid}) info from overriden bundle(${overrideBundleId})`);
    }
    let count = 1 + (packRequest.pcidsToAdd?.[pcid] || 0);
    for (let cloneId = 0; cloneId < count; cloneId++) {
      await this._createContainer({
        pcid,
        bundleId: packRequest.bundleId,
        packInfo,
        overrides: packRequest.overrides?.[pcid],
        cloneId,
      });
    }
  }
  await this._addWallE(packInfo);
  if (packInfo.addSniffer) {
    await this._addSniffer(packInfo);
  }
  delete packInfo.deployInProgress;
  await deployedInfo.save(packInfo);
  return packInfo;
}

/**
 * @this {import('..').DockerWrapper}
 * @param {DeployBundleRequest} request 
 * @returns 
 */
async function addPack(request)
{
  this.logger.log("[addPack]", {request});
  let bundleInfo = bundlesInfo.getItems().find(it=>it.id === request.bundleId);
  if (!bundleInfo) throw new Error(`Bundle (${request.bundleId}) not found`);
  this.deployChangeQueueLength++;
  const packId = `${++this._lastPackIdx}_${this.mdata.id}`;
  let maxClones = 1 + (request.pcidsToAdd ? Math.max(...Object.values(request.pcidsToAdd)) : 0);
  let assignedIpList = Array.from(this._ipList.values()).slice(0, maxClones);
  for (let ip of assignedIpList) {
    this._ipList.delete(ip);
  }
  /** @type {{[x:string]: string|object}} */
  const buildInfo = {};
  for (const [key, value] of Object.entries(bundleInfo.buildInfo || {})) {
    buildInfo[key + "_0"] = value;
  }
  /** @type {DeployedInfo} */
  let packInfo = {
    id: packId,
    dockerEngineId: this.mdata.id,
    builderId: bundleInfo.builderId,
    initialBundleId: request.bundleId,
    buildInfo,
    lastSave: 0,
    lastPing: 0,
    keepAlive: request.keepAlive || false,
    containersInfo: [],
    bananaLoad: request.bananaLoad || 0,
    ipList: assignedIpList,
    deployInProgress: true,
    comment: request.comment,
    collectPerformanceData: request.collectPerformanceData,
    bindHostTZ: request.bindHostTZ,
    addSniffer: request.addSniffer,
    autoRestart: request.autoRestart,
    monitorDumps: request.monitorDumps,
  }
  await deployedInfo.save(packInfo);
  if (request.bananaLoad) this.bananaUsage += request.bananaLoad;
  let task = this._queues.crudPack.postTask({
    type: "bundle_deploy",
    task: ()=>this._addPack(request, packInfo),
    params: request,
  });
  task.catch((error)=>{
    providers.docker.postError("Add Pack exception", error);
    this.removePack(packId).catch(c_blank);
  }).finally(()=>this.deployChangeQueueLength--);
  return task;
}

module.exports = {
  addPack,
  _addPack,
}