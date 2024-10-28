const { buildersInfo, dockerRegistriesInfo, bundlesInfo } = require("../../Database.cjs");

/**
 * @this {import('..').DockerWrapper}
 * @param {BuildBundleRequest} request
 * @param {BundleInfo} info
 * @returns 
 */
async function _createBundle(request, info)
{
  this.logger.log("[_createBundle]", {request, info});
  const docker = this._docker;
  const builderInfo = buildersInfo.getItems().find(it=>it.id === request.builderId);
  for (let imgInfo of builderInfo.images) {
    this.logger.log("[_createBundle]: processing", {pcid: imgInfo.pcid})
    let srcRepoName = "";
    let srcImageTag = "";
    let srcRegistryId = "";
    let repoName = "";
    let imageTag = "";
    let registryId = "";
    if (imgInfo.staticImage) {
      srcRegistryId = imgInfo.staticImage.registryId;
      let parts = imgInfo.staticImage.image.split(':');
      srcRepoName = parts[0];
      srcImageTag = parts[1] || "latest";
      repoName = srcRepoName;
      imageTag = srcImageTag;
      registryId = srcRegistryId;
    } else {
      let srcImageName = request.imagesInfo[imgInfo.pcid].imageName;
      let repoTag = srcImageName;
      let parsed = /^(.+:\d+)\/(.+)$/.exec(srcImageName);
      if (parsed) {
        let registryAddress = parsed[1];
        repoTag = parsed[2];
        let registryInfo = dockerRegistriesInfo.getItems();
        let existingsRegistry = registryInfo.find(it=>it.address === registryAddress);
        srcRegistryId = existingsRegistry?.id;
        registryId = srcRegistryId;
        if (!existingsRegistry) {
          srcRegistryId = registryAddress.replace(":", "_");
          if (registryInfo.find(it=>it.id == srcRegistryId)) {
            srcRegistryId += "_" + new Date();
          }
          await dockerRegistriesInfo.save({
            address: registryAddress,
            hidden: false,
            id: srcRegistryId,
            lastSave: 0,
            name: registryAddress + " (auto added)"
          })
        }
      }
      let parts = repoTag.split(":");
      srcRepoName = repoName = parts[0];
      srcImageTag = imageTag = parts[1] || "latest";
      if (imgInfo.cacheDst) {
        registryId = imgInfo.cacheDst.registryId;
        repoName = imgInfo.cacheDst.repoName;
        imageTag = imgInfo.cacheDst.imageTagPrefix + info.id;
      }
    }
    /** @type {ImageDeployInfo} */
    let imgDeployInfo = {
      imageTag,
      pcid: imgInfo.pcid,
      registryId,
      repoName,
      original: imgInfo.cacheDst ? {
        imageTag: srcImageTag,
        repoName: srcRepoName,
        registryId: srcRegistryId,
      } : undefined,
    }
    info.imagesToDeploy.push(imgDeployInfo);
    await bundlesInfo.save(info);
    if (imgInfo.cacheDst) {
      this.logger.log("[_createBundle]: caching", imgInfo.pcid)
      let srcRegistry = dockerRegistriesInfo.getItems().find(it=>it.id === srcRegistryId);
      let dstRegistry = dockerRegistriesInfo.getItems().find(it=>it.id === registryId);
      let fullSrcName = `${(srcRegistry ? srcRegistry.address + "/" : "")}${srcRepoName}:${srcImageTag}`;
      this.logger.log("[_createBundle]: pull", fullSrcName);
      this._pullImage(fullSrcName);
      this.logger.log("[_createBundle]: tag");
      await docker.getImage(fullSrcName).tag({repo: `${(dstRegistry.address)}/${repoName}`, tag: imageTag});
      let fullDstName = `${(dstRegistry.address)}/${repoName}:${imageTag}`;
      this.logger.log("[_createBundle]: push", fullDstName);
      let pushStream = await docker.getImage(fullDstName).push({tag: imageTag});
      await this._followProgress(pushStream);
    }
    this.logger.log("[_createBundle]: fin part", imgInfo.pcid)
  }
  delete info.corrupted;
  await bundlesInfo.save(info);
  this.logger.log("[_createBundle]: done")
  return info;
}

/**
 * @this {import('..').DockerWrapper}
 * @param {BuildBundleRequest} request
 * @returns 
 */
async function createBundle(/** @type {BuildBundleRequest} */ request)
{
  const builderInfo = buildersInfo.getItems().find(it=>it.id === request.builderId);
  if (!builderInfo) throw new Error("Builder not found");
  for (let imgInfo of builderInfo.images) {
    if (imgInfo.staticImage) continue;
    if (!request.imagesInfo[imgInfo.pcid] || !request.imagesInfo[imgInfo.pcid].imageName) {
      throw new Error(`Required image missing for pcid(${imgInfo.pcid})`);
    }
  }
  if (!builderInfo.nextResultId) builderInfo.nextResultId = 1;
  const infoId = request.id || `${builderInfo.resultPrefix}_${builderInfo.nextResultId++}`.replace("__", "_");
  buildersInfo.save(builderInfo);
  /** @type {BundleInfo} */
  let info = {
    corrupted: true,
    id: infoId,
    builderId: request.builderId,
    imagesToDeploy: [],
    lastSave: 0,
    buildInfo: Object.getOwnPropertyNames(request.imagesInfo)
      .filter(pcid=>request.imagesInfo[pcid].buildInfo)
      .map(pcid=>{
        let info = request.imagesInfo[pcid].buildInfo;
        try {info=JSON.parse(info)} catch {}
        return {pcid, info}
      })
      .reduce((prev, {pcid, info})=>Object.assign(prev, {[pcid]: info}), {}),
  };
  await bundlesInfo.save(info);
  return this._queues.other.postTask({
    type: "bundle_create",
    task: ()=>this._createBundle(request, info),
    params: request,
  });
}

module.exports = {
  _createBundle,
  createBundle,
}