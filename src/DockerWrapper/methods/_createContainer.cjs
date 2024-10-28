const { deployedInfo, bundlesInfo, buildersInfo, dockerRegistriesInfo } = require("../../Database.cjs");
const { StrArrToObjReduce, dedublicateArray } = require("../../common/utils.cjs");
const { 
  kernelDumps,
  pmNetworkName,
} = require("../common.cjs");

function AssignVars(/** @type {string[]}*/target, /** @type {{[x:string]: string}}*/ vars)
{
  let props = Object.getOwnPropertyNames(vars);
  return target.map(it=>props.reduce((prev, curr)=>prev.replace(curr, vars[curr]),it))
}

/**
 * @param {Object} param0 
 * @param {string} param0.registryId 
 * @param {string} param0.repoName 
 * @param {string} param0.imageTag 
 */
function makeImageName({registryId, repoName, imageTag})
{
  let registryAddress = "";
  if (registryId)
  {
    let registry = dockerRegistriesInfo.getItems().find(it=>it.id == registryId);
    if (!registry) throw new Error(`Registry(${registryId}) not found`);
    if (registry.address) {
      registryAddress = registry.address + "/";
    }
  }
  return `${registryAddress}${repoName}:${imageTag}`;
}

/**
 * @this {import('..').DockerWrapper}
 * @param {object} args 
 * @param {string} args.pcid
 * @param {string} args.bundleId
 * @param {DeployedInfo} args.packInfo
 * @param {OverrideParams} [args.overrides]
 * @param {number} [args.cloneId]
 * @param {"no"|"unless-stopped"} [args.restartPolicy]
 * @param {boolean} [args.bindHostTZ]
 * @param {string} [args.forceIp]
 * @param {boolean} [args.isUpgrade]
*/
async function _createContainer(args)
{
  this.logger.log("[_createContainer]", args);
  let {
    pcid,
    bundleId,
    packInfo,
    overrides = {},
    cloneId = 0,
    restartPolicy = "no",
    bindHostTZ,
    forceIp,
    isUpgrade = false,
  } = args;
  let bundleInfo = bundlesInfo.getItems().find(it=>it.id == bundleId);
  if (!bundleInfo) throw new Error(`Pack(${bundleId}) not found`);
  let builderInfo = buildersInfo.getItems().find(it=>it.id == bundleInfo.builderId)
  if (!builderInfo) throw new Error(`Builder(${bundleInfo.builderId}) not found`);
  let imageBuilderInfo = builderInfo.images.find(it=>it.pcid == pcid);
  if (!imageBuilderInfo) throw new Error(`Image info not found in builder for pcid(${pcid})`);
  let imageBundleInfo = bundleInfo;
  if (overrides?.imageFromBundleId) {
    const imageFromBundleId = overrides.imageFromBundleId;
    imageBundleInfo = bundlesInfo.getItems().find(it=>it.id == imageFromBundleId);
    if (!imageBundleInfo) throw new Error(`Pack(${imageFromBundleId}) not found`);
  }

  let Cmd = overrides?.Cmd || imageBuilderInfo.Cmd || [];
  if (Cmd && !Cmd[0]?.trim()) Cmd = null;

  let Entrypoint = overrides?.Entrypoint || imageBuilderInfo.Entrypoint || [];
  if (Entrypoint && !Entrypoint[0]?.trim()) Entrypoint = null;

  let Volumes = isUpgrade ? {} : StrArrToObjReduce(dedublicateArray((overrides?.volumes || imageBuilderInfo.volumes || [])));
  let Binds = overrides?.Binds || imageBuilderInfo.Binds || [];
  if (bindHostTZ) {
    Binds.push(...['/etc/timezone:/etc/timezone:ro', '/etc/localtime:/etc/localtime:ro']);
  }
  if (!Binds.find(it=>it.match(/:\/tmp\/cores$/))) {
    Binds.push(`${kernelDumps.HostDumpsRoot}/${pcid}:/tmp/cores`);
  }
  // "xxx:/tmp/qqq"||"xxx:/tmp/qqq:ro"||"yyy:/tmp/qqq:ro" - must be only one
  // can dublicate on container upgrade, or override, or ...
  // leave last one..
  /** @type {number[]} */
  let bindsToCleanup = [];
  Binds.forEach((value1, idx1)=>{
    let parsed1 = /:([^:]+)/.exec(value1);
    if (!parsed1) throw new Error(`Bad bind (${value1})`);
    let path1 = parsed1[1];
    // created volumes become binds in container info
    // if its create for update - there can be old volume binded data with new volume request..
    // *volumes used to transfer app data to new container on update..
    if (Volumes[path1]) {
      delete Volumes[path1];
    }
    let lastIdx = idx1;
    for (let idx2 = idx1 + 1; idx2 < Binds.length; idx2++) {
      let value2 = Binds[idx2];
      let parsed2 = /:([^:]+)/.exec(value2);
      if (!parsed2) throw new Error(`Bad bind (${value2})`);
      if (parsed2[1] == path1) {
        bindsToCleanup.push(lastIdx);
        lastIdx = idx2;
      }
    }
  });
  bindsToCleanup.reverse().forEach(idx=>Binds.splice(idx, 1));

  let requiredResources = (overrides?.sharedResources || imageBuilderInfo.sharedResources || []);
  for (let resourceId of requiredResources) {
    await this._checkSharedResources(resourceId);
  }
  // let VolumesFrom = requiredResources.map(it=>this._getSharedResourceName());

  let pcidUsedIp = packInfo.containersInfo.filter(it=>it.pcid == pcid).map(it=>it.ip);
  let ip = forceIp || packInfo.ipList.find(it=>!pcidUsedIp.includes(it));
  let packVars = {
    "${CIP}": ip,
    "${MIP}": packInfo.ipList[0],
    "${DUMPS}": "/tmp/cores",
  };
  let netGroup = ip.split('.')[3];
  let gatePrefix = this.mdata.network.gateway.split(".").slice(0, 2).join(".");
  let internalIp = "";
  let overlappedIp = true;
  for (let netOctet4 = 1; overlappedIp && netOctet4 < 254; netOctet4++)
  {
    internalIp = `${gatePrefix}.${netGroup}.${netOctet4}`;
    overlappedIp = !!packInfo.containersInfo.find(it=>it.internalIp == internalIp);
  }
  if (overlappedIp)
  {
    // 255 containers in pack??
    throw new Error('must never happen');
  }

  /**
   * @param {string} protocol 
   * @param {string} assignedIp 
   * @param {{[x:string]: {}|[{HostIp: string, HostPort: string}]}} acc 
   * @param {string} info 
   * @returns 
   */
  function portReducer (protocol, assignedIp, acc, info) {
    let portMaps = info.split(":");
    if (!portMaps[1]) portMaps.push(portMaps[0]);
    let hostPorts = portMaps[0].split("-");
    let hostCount = hostPorts[1] ? (+hostPorts[1]) - (+hostPorts[0]) : 1;
    let internalPorts = portMaps[1].split("-");
    let internalCount = internalPorts[1] ? (+internalPorts[1]) - (+internalPorts[0]) : 1;
    if (hostCount != internalCount) throw new Error("Unalign port maps");
    let startHostPort = +hostPorts[0];
    let startInternalPort = +internalPorts[0];
    for (let shift = 0; shift < hostCount; shift++) {
      let value = assignedIp ? [{HostIp: assignedIp, HostPort: String(startHostPort + shift)}] : {};
      acc[`${startInternalPort + shift}/${protocol}`] = value;
    }
    return acc
  };
  let portsInfo = {
    tcp: overrides?.tcpPorts || imageBuilderInfo.tcpPorts || [],
    udp: overrides?.udpPorts || imageBuilderInfo.udpPorts || [],
  }
  const makePortsData = (/** @type {string}*/ip = null)=>{
    return portsInfo.tcp.reduce(portReducer.bind(this, "tcp", ip),
            portsInfo.udp.reduce(portReducer.bind(this, "udp", ip), {}));
  };

  let Env = overrides?.Env || imageBuilderInfo.Env || [];
  // 4 .net dumps, mark pcid as .net with flag in description, autoadd?
  // Env = Env.concat([
  //   "COMPlus_DbgEnableMiniDump=1",
  //   "COMPlus_DbgMiniDumpName=/tmp/cores/core.dotnet_%e.%p.%h.%t",
  //   "COMPlus_DbgMiniDumpType=4",
  // ])

  /** @type {ContainerCreateOptions} */
  let options = {
    name: this._getNextContainerName(packInfo.id, pcid, cloneId),
    Image: makeImageName(imageBundleInfo.imagesToDeploy.find(it=>it.pcid == pcid)),
    Cmd: Cmd && AssignVars(Cmd, packVars),
    Entrypoint: Entrypoint && AssignVars(Entrypoint, packVars),
    ExposedPorts: overrides.ExposedPorts || makePortsData(),
    Volumes,
    Env: Env && AssignVars(Env, packVars),
    Hostname: `${pcid}_${cloneId}_${packInfo.id}`.slice(0, 15),
    Tty: false,
    StopSignal: "SIGINT",
    HostConfig: {
      PortBindings: overrides.PortBindings || makePortsData(ip),
      Binds,
      CapAdd: dedublicateArray(["SYS_PTRACE", "CAP_SYS_ADMIN", ...(overrides?.CapAdd || imageBuilderInfo.CapAdd || [])]),
      // VolumesFrom,
      // user wants to know when service crushed.. "no" by default
      RestartPolicy: {Name: restartPolicy},
      LogConfig: {
        Type: "json-file",
        Config: {
          "max-size": "10m",
          "max-file": "10",
        }
      },
    },
    NetworkingConfig: {
      EndpointsConfig: {
        [pmNetworkName]: {
          IPAMConfig: {
            IPv4Address: internalIp,
          }
        }
      }
    },
  };
  this.logger.log("_createContainer options", JSON.stringify(options, null, 2))
  /** @type {DeployedContainerInfo} */
  let containerInfo = {
    id: undefined,
    name: options.name,
    pcid,
    cloneId,
    bundleId: imageBundleInfo.id,
    ip,
    internalIp,
    dockerOptions: options,
    createTime: new Date().toISOString(),
  }
  packInfo.containersInfo.push(containerInfo);
  if (!packInfo.buildInfo) packInfo.buildInfo = {};
  packInfo.buildInfo[pcid + "_" + cloneId] = imageBundleInfo.buildInfo?.[pcid];
  await deployedInfo.save(packInfo);
  let container = undefined;
  if (options.Image.match(/:latest$/)) {
    await this._pullImage(options.Image);
  }
  try {
    // 99% cases - image already there & saves tests time on "useless" pull checks
    container = await this._dockerCreateContainer(options);
  } catch (error) {
    if (!error?.error?.message?.includes("HTTP code 404")) {
      console.log("first create attempt failed unexpectedly", error);
      throw error;
    }
    await this._pullImage(options.Image);
    container = await this._dockerCreateContainer(options);
  }
  containerInfo.id = container.id;
  await deployedInfo.save(packInfo);
  await container.start();
}

module.exports = {
  _createContainer,
}