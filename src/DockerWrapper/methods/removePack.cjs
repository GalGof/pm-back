const { deployedInfo } = require("../../Database.cjs");
const { providers } = require("../../Notifications.cjs");
const { c_blank } = require("../../common/callbackUtils.cjs");

/**
 * @this {import('..').DockerWrapper}
 * @param {DeployedInfo} pack 
 * @returns 
 */
async function _removePack(pack)
{
  this.logger.log("[_removePack]", {deployedId: pack.id});
  const docker = this._docker;
  const hostContainers = await docker.listContainers({all: true});
  for (let item of pack.containersInfo) {
    await this._removeContainer(item.name, hostContainers);
  }
  if (pack.bananaLoad) this.bananaUsage -= pack.bananaLoad;
  for (let ip of pack.ipList) {
    this._ipList.add(ip);
  }
  await deployedInfo.delete(pack.id);
  const pruneType = "prune_volumes";
  if (!this._queues.prune.findTaskInQueue(it=>it.data.type == pruneType)) {
    await this._queues.prune.postTask({
      type: pruneType,
      task: ()=>docker.pruneVolumes().catch(c_blank),
    })
  }
}

/**
 * @this {import('..').DockerWrapper}
 * @param {string} deployedId 
 * @returns 
 */
async function removePack(deployedId)
{
  this.logger.log("[removePack]", {deployedId});
  const pack = this._getDeployedPack(deployedId);
  const taskType = "pack_remove";
  if (this._queues.crudPack.findTaskInProgress(it=>it.data.type == taskType && it.data.params.deployedId == deployedId)) {
    throw new Error("Already queued for deletion");
  }
  // if (!redelete && pack.markedForDelete) throw new Error("Already queued for deletion");
  this.deployChangeQueueLength++;
  pack.markedForDelete = true;

  let task = this._queues.crudPack.postTask({
    type: taskType,
    task: ()=>this._removePack(pack),
    params: {deployedId},
  });
  // after posting task - to prevent repeated remove call while waiting for save
  await deployedInfo.save(pack);

  task.catch((error)=>{
    pack.corrupted = true;
    pack.markedForDelete = false;
    providers.docker.postError("Remove Pack exception", error);
    return deployedInfo.save(pack);
  }).finally(()=>this.deployChangeQueueLength--);
  return task;
}

module.exports = {
  removePack,
  _removePack,
}