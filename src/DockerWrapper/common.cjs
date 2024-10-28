const SysPcid = {
  wallE: "wallE",
  sniffer: "sharkE",
}

const ResourcesRegistryId = "PM_Resources";
const pmNetworkName = "pm_network";
const SnifferRepoName = "sniffer";
const proxySocketsPath = "./database/proxySockets";

const kernelDumps = {
  HostDumpsRoot: "/var/opt/puppets-master/dumps",
  expectedConfig: "/tmp/cores/core.%e.%p.%h.%t",
}

const timers = {
  AutoDeleteTimeoutMs: 5 * 60 * 1000,
  AutoDeleteCheckPeriodMs: 60 * 1000,
  ContainerStateUpdatePeriodSec: 60,
  PingCheckIntervalMs: 60000,
  DumpsCheckIntervalMs: 5 * 60 * 1000,
  OldDataCleanupIntervalMs: 86400 * 3 * 1000,
  PerformanceCollectionIntervalMs: 300 * 1000,
}

module.exports = {
  SysPcid,
  ResourcesRegistryId,
  pmNetworkName,
  kernelDumps,
  SnifferRepoName,
  proxySocketsPath,
  timers,
}