const { deployedInfo, dockerRegistriesInfo } = require("../../Database.cjs");
const { SysPcid, ResourcesRegistryId, SnifferRepoName, kernelDumps } = require("../common.cjs");
const path = require('path');

/**
 * @this {import('..').DockerWrapper}
 * @param {{pcid: string, cloneId: number, dataPath: string}} param
 * @returns 
 */
function _toWallePath({pcid, cloneId, dataPath})
{
  return path.join(`/data_mounts/${pcid}_${cloneId}`, dataPath);
}

/**
 * @this {import('..').DockerWrapper}
 * @param {DeployedInfo} packInfo 
 * @returns 
 */
async function _addWallE(packInfo)
{
  this.logger.log("_addWallE", {packId: packInfo.id})
  try {
    let docker = this._docker;
    let registry = dockerRegistriesInfo.getItems().find(it=>it.id == ResourcesRegistryId);
    let imageName = `${registry.address}/alpine`;
    await this._pullImage(imageName);
    let name = this._getNextContainerName(packInfo.id, SysPcid.wallE);
    let Binds = [
      `${kernelDumps.HostDumpsRoot}:/HostDumpsRoot`,
    ];
    for (let containerInfo of packInfo.containersInfo) {
      let inspectInfo = await docker.getContainer(containerInfo.id).inspect();
      for (let bind of inspectInfo.HostConfig.Binds) {
        Binds.push(bind.replace(':', `:/PM/${containerInfo.pcid}_${containerInfo.cloneId}`));
      }
    }
    let container = await this._dockerCreateContainer({
      Image: imageName,
      name,
      Entrypoint: "/bin/sh",
      StopSignal: "SIGKILL",
      Tty: true,
      HostConfig: {
        Binds,
        VolumesFrom: packInfo.containersInfo.map(it=>`${it.name}`),
        RestartPolicy: {Name: "unless-stopped"},
      },
    });
    packInfo.containersInfo.push({
      id: container.id,
      name,
      pcid: SysPcid.wallE,
      isSysPcid: true,
      cloneId: 0,
      internalIp: "TODO",
      createTime: new Date().toISOString(),
    });
    await deployedInfo.save(packInfo);
    await this._startAndWaitForContainer(container.id);
  } catch (error) {
    this.logger.error("_addWallE exception", error);
    throw error;
  }
}

/**
 * @this {import('..').DockerWrapper}
 * @param {DeployedInfo} packInfo 
 * @returns 
 */
async function _removeWallE(/** @type {DeployedInfo} */ packInfo)
{
  let wallEIdx = packInfo.containersInfo.findIndex(it=>it.pcid == SysPcid.wallE);
  if (wallEIdx < 0) return;
  let wallE = packInfo.containersInfo[wallEIdx];
  await this._removeContainer(wallE.name);
  packInfo.containersInfo.splice(wallEIdx, 1);
  await deployedInfo.save(packInfo);
}

/**
 * @this {import('..').DockerWrapper}
 * @param {DeployedInfo} packInfo 
 * @returns 
 */
async function _addSniffer(/** @type {DeployedInfo} */ packInfo)
{
  let registry = dockerRegistriesInfo.getItems().find(it=>it.id == ResourcesRegistryId);
  if (!registry) throw new Error("No resources registry");
  let targets = new Set();
  let gateway = this.mdata.network.gateway;
  packInfo.containersInfo.forEach(it=>{
    if (it.internalIp) targets.add(it.internalIp);
  });
  let name = this._getNextContainerName(packInfo.id, SysPcid.sniffer);
  /** @type {ContainerCreateOptions} */
  let dockerOptions = {
      Image: `${registry.address}/${SnifferRepoName}:latest`,
      Env: [
          `targets=${Array.from(targets).join(' or ')}`,
          `gateway=${gateway}`,
          `filename=network_data.pcap`,
      ],
      Tty: true,
      name,
      HostConfig: {
          RestartPolicy: {Name: "unless-stopped",},
          CapAdd: ["NET_ADMIN"],
          NetworkMode: "host",
      },
      StopSignal: "SIGINT",
      Volumes: {"/snifferOutput":{}},
  };
  /** @type {DeployedContainerInfo} */
  let info = {
    id: undefined,
    cloneId: 0,
    pcid: SysPcid.sniffer,
    isSysPcid: true,
    internalIp: undefined,
    name,
    dockerOptions,
    createTime: new Date().toISOString(),
  }
  packInfo.containersInfo.push(info);
  // so, in case of crash or a like - we have info about started containers..
  await deployedInfo.save(packInfo);
  await this._pullImage(dockerOptions.Image);
  let container = await this._dockerCreateContainer(dockerOptions);
  info.id = container.id;
  await deployedInfo.save(packInfo);
  await this._startAndWaitForContainer(container.id);
}

/**
 * @this {import('..').DockerWrapper}
 * @param {DeployedInfo} packInfo 
 * @returns 
 */
async function _removeSniffer(packInfo)
{
  let idx = packInfo.containersInfo.findIndex(it=>it.pcid == SysPcid.sniffer);
  if (idx < 0) return;
  await this._removeContainer(packInfo.containersInfo[idx].name);
  packInfo.containersInfo.splice(idx, 1);
  await deployedInfo.save(packInfo);
}

module.exports = {
  _removeSniffer,
  _addSniffer,
  _removeWallE,
  _addWallE,
  _toWallePath,
}