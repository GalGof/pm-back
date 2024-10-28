const { sharedDataInfo } = require("../../Database.cjs");

/**
 * @this {import('..').DockerWrapper}
 * @param {string} resouiceId 
 * @returns 
 */
function _getSharedResourceName(resouiceId)
{
  return `PM_SR_${resouiceId}`;
}

/**
 * @this {import('..').DockerWrapper}
 * @param {string} sharedResourceId 
 * @returns 
 */
async function _checkSharedResources(resouiceId)
{
  let resourceInfo = sharedDataInfo.getItems().find(it=>it.id == resouiceId);
  if (!resourceInfo) throw new Error(`Unknown shared resource(${resouiceId})`)
  if (this._shared_resources_checked[resourceInfo.id]) return;
  let name = this._getSharedResourceName(resourceInfo.id);
  if (!(await this.listContainers()).find(it=>it.Names[0] == "/" + name)) {
    let registry = dockerRegistriesInfo.getItems().find(it=>it.id == resourceInfo.dockerRegistryId);
    let imageName = `${registry.address}/${resourceInfo.image}`;
    let docker = this._docker;
    await docker.pull(imageName);
    let container = await this._dockerCreateContainer({
      name,
      Image: imageName,
      Volumes: {
        [resourceInfo.dataPath]: {},
      },
    });
    await container.start();
  }
  this._shared_resources_checked[resourceInfo.id] = true;
}

/**
 * @this {import('..').DockerWrapper}
 */
async function clearSharedResources()
{
  // https://github.com/microsoft/TypeScript/issues/43812
  (this)._shared_resources_checked = {};
  let containers = await this.listContainers();
  let docker = this._docker;
  for (let item of sharedDataInfo.getItems()) {
    let name = this._getSharedResourceName(item.id);
    await this._removeContainer(name, containers);
  }
  await docker.pruneVolumes().catch(()=>{});
}

module.exports = {
  _checkSharedResources,
  _getSharedResourceName,
  clearSharedResources,
}