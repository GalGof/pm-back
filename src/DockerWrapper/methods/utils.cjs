const { deployedInfo } = require("../../Database.cjs");

/**
 * @this {import('..').DockerWrapper}
 * @param {string} packId
 * @param {string} pcid
 * @param {number} [cloneId]
 */
function _getNextContainerName(packId, pcid, cloneId=0)
{
  return `PM_${this._lastContainerIdx++}_${pcid}_${cloneId}_${packId}_${+new Date()}`;
}

/**
 * @this {import('..').DockerWrapper}
 * @param {string} deployedId
 */
function _getDeployedPack(deployedId)
{
  const pack = this._deployedPacks.find(it=>it.id == deployedId);
  if (!pack) throw new Error("Pack not found");
  return pack;
}

/**
 * @this {import('..').DockerWrapper}
 * @param {string} deployedId
 */
async function pingPack(deployedId)
{
  const pack = this._getDeployedPack(deployedId);
  if (pack.markedForDelete) throw new Error("Already queued for deletion");
  pack.lastPing = +new Date();
  await deployedInfo.save(pack);
}

/**
 * @this {import('..').DockerWrapper}
 * @param {{packId: string}} param
 */
function _getPack({packId})
{
  let pack = deployedInfo.getItems().find(it=>it.id === packId);
  if (!pack) {
    throw new Error(`Pack(${packId}) not found`);
  }
  return pack;
}

/** 
 * @this {import('..').DockerWrapper}
 * @param {{packId: string, pcid: string, cloneId?: number}} param
 * */
function _getContainerInfo({packId, pcid, cloneId=0})
{
  let container = this._getPack({packId}).containersInfo
    .find(it=>it.pcid === pcid && it.cloneId === cloneId);
  if (!container) {
    throw new Error(`Container(${pcid}:${cloneId}) not found in pack(${packId})`);
  }
  return container;
}

module.exports = {
  _getContainerInfo,
  _getDeployedPack,
  _getNextContainerName,
  _getPack,
  pingPack,
}