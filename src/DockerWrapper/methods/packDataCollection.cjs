/**
 * @this {import('..').DockerWrapper}
 * @param {object} param0 
 * @param {string} param0.packId
 * @param {string} param0.pcid
 * @param {number} param0.cloneId
 * @param {string} param0.dataPath
 */
async function _getPathDataInfoFromWallE({packId, pcid, cloneId, dataPath})
{
  let execResult = await this._containerExec({
    containerId: this._getContainerInfo({packId, pcid, cloneId}).id,
    Cmd: ['ls', '-ls', '--full-time', this._toWallePath({pcid, cloneId, dataPath})],
    WorkingDir: "/",
    includeStdOut: true,
  });
  return execResult;
}

/**
 * @this {import('..').DockerWrapper}
 */
async function _collectPackData()
{

}

/** 
 * @this {import('..').DockerWrapper}
 * @param {{containerId: string, path: string}} param
 * */
async function _getFilesInfo({containerId, path})
{
  let container = this._docker.getContainer(containerId);
  let info = await container.infoArchive({path});
  this.logger.log("_getFilesInfo", info);
  return info;
}

module.exports = {
  _collectPackData,
  _getFilesInfo,
  _getPathDataInfoFromWallE,
}