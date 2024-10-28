const { deployedInfo } = require("../../Database.cjs");
const { providers } = require("../../Notifications.cjs");

/**
 * @this {import('..').DockerWrapper}
 * @param {{request: UpgradeDeployedRequest, pack: DeployedInfo, testUpdate: boolean}} param
 */
async function _upgradePack({request, pack, testUpdate})
{
  let orgPack = pack;
  let additionalIpRequired = 0;
  let freeIpList = this._ipList;
  if (testUpdate) {
    request = JSON.parse(JSON.stringify(request));
    pack = JSON.parse(JSON.stringify(pack));
    freeIpList = new Set(freeIpList);
  }
  {
    /** @type {("collectPerformanceData"|"bindHostTZ"|"autoRestart"|"comment"|"monitorDumps"|"addSniffer"|"userTag")[]} */
    const props = ["collectPerformanceData", "bindHostTZ", "autoRestart", "comment", "monitorDumps", "addSniffer", "userTag"];
    for (const prop of props) {
      if (request[prop] !== undefined) {
        //@ts-ignore
        pack[prop] = request[prop];
      }
    }
  }
  const restartPolicy = request.autoRestart ? "unless-stopped" : "no";
  const bindHostTZ = request.bindHostTZ;
  if (!testUpdate) {
    await this._removeWallE(pack);
    await this._removeSniffer(pack);
  }
  let containersList = await this.listContainers();
  for (const idToRemove of request.containersToDelete || []) {
    let idx = pack.containersInfo.findIndex(it=>it.id == idToRemove);
    if (idx < 0) throw new Error("Bad request. desynced?");
    let info = pack.containersInfo[idx];
    if (!testUpdate) {
      await this._removeContainer(info.name, containersList);
    }
    pack.containersInfo.splice(idx, 1)[0];
    if (!testUpdate) {
      await deployedInfo.save(pack);
    }
  }
  let unusedPackIpList = pack.ipList.filter(it=>!pack.containersInfo.find(itToo=>itToo.ip == it));
  this.logger.debug("_upgradePack", {unusedPackIpList})
  for (const ip of unusedPackIpList) {
    pack.ipList.splice(pack.ipList.indexOf(ip), 1)
    freeIpList.add(ip);
  }

  for (const upgradeInfo of request.containersToUpgrade || []) {
    let oldIdx = pack.containersInfo.findIndex(it=>it.id == upgradeInfo.id);
    if (oldIdx < 0) throw new Error("Bad request. desynced?");
    let oldInfo = pack.containersInfo[oldIdx];
    /** @type {OverrideParams} */
    let overrides = JSON.parse(JSON.stringify(upgradeInfo.override || {}));
    if (!testUpdate) {
      let oldContainer = this._docker.getContainer(upgradeInfo.id);
      await this._stopContainer(upgradeInfo.id);
      let oldInspect = await oldContainer.inspect();
      {
        /** @type {("Cmd"|"Entrypoint"|"Env")[]}*/
        let props = ["Cmd", "Entrypoint", "Env"];
        for (const prop of props) {
          if (!overrides[prop]?.length || overrides[prop]?.join('') == "") {
            //@ts-ignore
            overrides[prop] = oldInspect.Config[prop];
          }
        }
      }
      {
        /** @type {("Binds"|"CapAdd")[]}*/
        let props = ["Binds", "CapAdd"];
        for (const prop of props) {
          if (!overrides[prop]) {
            overrides[prop] = [];
          }
        }
        if (!overrides.CapAdd.length || overrides.CapAdd.join('') == "") {
          overrides.CapAdd = oldInspect.HostConfig.CapAdd;
        }
        for (const it of oldInspect.Mounts) {
          let bindStr = `${it.Source}:${it.Destination}:${it.RW ? 'rw' : 'ro'}`;
          if (it.Propagation) {
            bindStr += "," + it.Propagation;
          }
          overrides.Binds.push(bindStr);
        }
      }
      if (!overrides.tcpPorts && !overrides.udpPorts) {
        overrides.PortBindings = oldInspect.HostConfig.PortBindings;
        overrides.ExposedPorts = oldInspect.Config.ExposedPorts;
      }
      await this._createContainer({
        pcid: oldInfo.pcid,
        cloneId: oldInfo.cloneId,
        packInfo: pack,
        bundleId: upgradeInfo.override.imageFromBundleId,
        overrides,
        bindHostTZ,
        restartPolicy,
        forceIp: oldInfo.ip,
        isUpgrade: true,
      });
      await this._removeContainer(oldInfo.name, containersList);
    }
    pack.containersInfo.splice(oldIdx, 1);
    if (!testUpdate) {
      await deployedInfo.save(pack);
    }
  }

  for (const addInfo of request.pcidsToAdd || []) {
    let finalClonesCount = addInfo.count + pack.containersInfo.filter(it=>it.pcid == addInfo.pcid).length;
    let newIpCount = finalClonesCount - pack.ipList.length;
    console.log("_upgradePack", {pcid: addInfo.pcid, finalClonesCount, newIpCount})
    if (newIpCount > 0) {
      if (newIpCount > freeIpList.size) {
        throw new Error("Bad request. Host has no free ip for new clones.")
      }
      additionalIpRequired += newIpCount;
      let newIps = Array.from(freeIpList).splice(0, newIpCount);
      for (const ip of newIps) {
        freeIpList.delete(ip);
      }
      pack.ipList.push(...newIps);
    }
    if (!testUpdate) {
      await deployedInfo.save(pack);
    }
    let maxOldCloneId = Math.max(...pack.containersInfo.filter(it=>it.pcid == addInfo.pcid).map(it=>it.cloneId));
    for (let i = 0; i < addInfo.count; i++) {
      if (!testUpdate) {
        await this._createContainer({
          bundleId: addInfo.override.imageFromBundleId,
          overrides: addInfo.override,
          packInfo: pack,
          pcid: addInfo.pcid,
          cloneId: maxOldCloneId + i + 1,
          restartPolicy,
          bindHostTZ,
        });
      }
    }
  }
  if (!testUpdate) {
    await this._addWallE(pack);
    if (pack.addSniffer) {
      await this._addSniffer(pack);
    }
    this._scheduleUpdateContainersState(5);
  } else {
    if (additionalIpRequired > this._ipList.size + unusedPackIpList.length) {
      throw new Error("Upgrade require more free ips on host");
    }
    for (const ip of unusedPackIpList) {
      this._ipList.add(ip);
    }
    let reservedIp = additionalIpRequired ? Array.from(this._ipList).splice(-additionalIpRequired) : [];
    this.logger.debug("_upgradePack", {reservedIp, additionalIpRequired, leftovers: this._ipList})
    for (const ip of reservedIp) {
      this._ipList.delete(ip);
    }
    orgPack.ipList.push(...reservedIp);
    await deployedInfo.save(orgPack);
  }
}

/**
 * @this {import('..').DockerWrapper}
 * @param {UpgradeDeployedRequest} request 
 */
async function upgradePack(/** @type {UpgradeDeployedRequest}*/ request)
{
  this.logger.log("upgradePack request", JSON.stringify(request, null, 2))
  const pack = this._getDeployedPack(request.packId);
  if (pack.markedForDelete) throw new Error("Already queued for deletion");
  // temporary packs usecase - for autotests. dont need upgrades 
  if (!pack.keepAlive) throw new Error("Temporary pack upgrades blocked.");
  if (pack.upgradeInProgress) throw new Error("Upgrade already queued.");
  pack.upgradeInProgress = true;
  await deployedInfo.save(pack);

  let task = this._queues.crudPack.postTask({
    type: "pack_upgrade",
    task: ()=>this._upgradePack({request, pack, testUpdate: true})
      .then(()=>this._upgradePack({request, pack, testUpdate: false})),
    params: request,
  });
  task.catch(async (error)=>{
    providers.docker.postError("Upgrade Pack exception", error);
    pack.corrupted = true;
    // release possible reserved ips
    let unusedIpIdx = [];
    for (const [idx, ip] of pack.ipList.entries()) {
      if (!pack.containersInfo.find(it=>it.ip == ip)) {
        unusedIpIdx.push(idx);
      }
    }
    for (const idx of unusedIpIdx.reverse()) {
      this._ipList.add(pack.ipList.splice(idx, 1)[0]);
    }
    await deployedInfo.save(pack)
  }).finally(async ()=>{
    delete pack.upgradeInProgress;
    delete pack.corrupted;
    await deployedInfo.save(pack);
  });
  return task;
}

module.exports = {
  upgradePack,
  _upgradePack,
}