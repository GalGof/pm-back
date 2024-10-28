type ApiDockerAction = {
  dockerId: string;
}

type ApiDockerContainerAction = ApiDockerAction & {
  containerId: string;
  params?: any;
}

type ApiDockerPackActions = ApiDockerAction & {
  packId: string;
}

type ApiMainController = {

}

type ImageBuilderInfo = {
  pcid: string;
  cacheDst?: {
    repoName: string;
    imageTagPrefix: string;
    registryId: string;
  };
  staticImage?: {
    image: string;
    registryId: string;
  }
  updatable?: boolean;
  clonable?: boolean;
  sharedResources?: string[];
  dataToSave?: string[];
  cmdVariants?: {
    name: string;
    cmd: string[];
  }[];
  customCommands?: {
    name: string;
    cmd: string[];
  }[]
  tcpPorts?: string[];
  udpPorts?: string[];
  Env?: string[];
  Cmd?: string[];
  Entrypoint?: string[];
  CapAdd?: string[];
  Binds?: string[];
  volumes?: string[];
  // for gdb debug
  appBinPath?: string;
  // for ws terminal connection. "/bin/sh" by default
  terminal?: string;
}

type BuilderInfo = BaseDBItem & {
  hidden: boolean;
  images: ImageBuilderInfo[];
  name: string;
  resultPrefix: string;
  nextResultId: number;
}

type BuildBundleRequest = {
  id?: string;
  builderId: string;
  imagesInfo: {
    [pcid: string]: {
      imageName: string;
      buildInfo?: any;
    }
  };
};

type BuildBundleQueueItem = {
  request: BuildPackRequest;
  callback: (res: Promise<BundleInfo>)=>void;
  id: string;
  lastSave: number;
  addTime: string;
  missCount: number;
  buildInProgress: boolean;
}

// description what was created on docker host
type DeployedInfo = BaseDBItem & {
  dockerEngineId: string;
  bananaLoad?: number;
  keepAlive?: boolean;
  lastDumpsCheck?: number;
  lastDumpsInfo?: PackDumpsInfo;

  ipList: string[];
  builderId: string;
  initialBundleId: string;
  buildInfo?: {[pcid: string]: string|object};
  containersInfo: DeployedContainerInfo[];

  lastPing?: number;
  
  markedForDelete?: boolean;
  upgradeInProgress?: boolean;
  deployInProgress?: boolean;
  corrupted?: boolean;
} & DeployUpgradeCommonParams

type DeployedContainerInfo = ContainerInfo & {
  pcid: string;
  isSysPcid?: boolean;
  bundleId?: string;
  internalIp?: string;
  cloneId: number;
  name: string;
  createTime: string;
  // deployInfo?: ImageDeployInfo;
  ip?: string;
  dockerOptions?: ContainerCreateOptions;
  appBinPath?: string;

  // docker's containers list info
  state?: string;
  status?: string;
  // has "ps" inside for performance collection
  noPs?: boolean;
}

// describes how container shall be created from image
type ImageDeployInfo = {
  pcid: string;
  repoName: string;
  imageTag: string;
  registryId: string;
  original?: {
    registryId: string;
    repoName: string;
    imageTag: string;
  }
}

// describes how to deploy "product" pack
type BundleInfo = BaseDBItem & {
  persistent?: boolean;
  builderId: string;
  imagesToDeploy: ImageDeployInfo[];
  buildInfo?: {[pcid: string]: any};
  corrupted?: boolean;
}

type OverrideParams = {
  
  volumes?: string[];
  sharedResources?: string[];
  // hostPort:internalPort
  tcpPorts?: string[];
  udpPorts?: string[];
  imageFromBundleId?: string;

  // in docker format.
  Cmd?: string[];
  Entrypoint?: string[];
  Env?: string[];
  CapAdd?: string[];
  Binds?: string[];
  // for upgrade
  PortBindings?: {};
  ExposedPorts?: {};
}

type DeployUpgradeCommonParams = {
  comment?: string;
  bindHostTZ: boolean;
  collectPerformanceData?: boolean;
  monitorDumps?: boolean;
  addSniffer?: boolean;
  autoRestart?: boolean;
  userTag?: string;
}

// deploy request
type DeployBundleRequest = {
  bundleId: string;
  dockerEngineFilters?: string[];
  // change deploy params per image for special cases
  // like run app with custom args & etc
  overrides?: {
    [pcid: string]: OverrideParams;
  };
  pcidsToAdd?: {
    [pcid: string]: number;
  };
  // limit banana load for docker host.
  bananaLoad?: number;
  keepAlive?: boolean;
} & DeployUpgradeCommonParams

type UpgradeDeployedRequest = {
  packId: string;
  containersToUpgrade?: {
    id: string;
    override: OverrideParams;
  }[];
  pcidsToAdd?: {
    pcid: string;
    count: number;
    override: OverrideParams;
  }[];
  containersToDelete?: string[];
} & DeployUpgradeCommonParams

type DeployQueueItem = {
  request: DeployBundleRequest;
  callback: (res: Promise<DeployedInfo>)=>void;
  id: string;
  lastSave: number;
  addTime: string;
  missCount: number;
}

type DWBaseTask = {
  task: ()=>Promise<any>;
  // type?: string;
}

type DWSimpleTask = DWBaseTask & {
  type: "re_init"|"ping_check"|"create_container"|"prune_volumes"|"timer_task"|"stop"|"list_containers"|"cleanupOldData"|"getDumpsInfo";
  params?: {packId?: string};
}

type DWBuildBundleTask = DWBaseTask & {
  type: "bundle_create";
  params: BuildBundleRequest;
}

type DWDeployTask = DWBaseTask & {
  type: "bundle_deploy";
  params: DeployBundleRequest;
}

type DWRemoveTask = DWBaseTask & {
  type: "pack_remove";
  params: {
    deployedId: string
  };
}

type DWUpgradeTask = DWBaseTask & {
  type: "pack_upgrade";
  params: UpgradeDeployedRequest;
}

type DWPullTask = DWBaseTask & {
  type: "pull";
  params: {imageName: string};
}

type DWDeleteContainerTask = DWBaseTask & {
  type: "delete_container";
  params: {name: string};
}

type DWTask = DWPullTask | DWDeployTask | DWRemoveTask | DWUpgradeTask | DWBuildBundleTask | DWSimpleTask | DWDeleteContainerTask;
type DWQTask = {id: string, resolve: (value?: any)=>any, reject: (reason?: any)=>void, queueTime: number, getPromise: ()=>Promise<any>, data: DWTask}

type DockerEngineInfo = BaseDBItem & {
  disabled?: boolean;
  name: string;
  connection: {
    protocol: "https"|"http"|"ssh";
    host: string;
    port?: number;
    sshKey?: string;
    username?: string;
    password?: string;
  }
  network: {
    gateway?: string;
    // format "xxx.xxx.xxx.xxx"
    ipList?: string[];
    ipRange?: {
      // format "xxx.xxx.xxx.xxx"
      start: string;
      count: number;
    };
  }
  bananasLimit: number;
  labels: string[];
  autoSetCorePattern?: boolean;
  lastTimerExecutedMark?: {
    [name: string]: number;
  }
}

type ContainerInfo = {
  id: string;
}

type DockerRegistryInfo = BaseDBItem & {
  name: string;
  address: string;
  hidden?: boolean;
}

type SharedDataInfo = BaseDBItem & {
  hidden: boolean;
  name: string;
  image: string;
  dockerRegistryId: string;
  dataPath: string[];
}

type ContainerCreateOptions = import('dockerode').ContainerCreateOptions

type OnInitMSG<T> = {
  dbName: string;
  operation: "db.init";
  items: T[];
  type: string;
}

type OnChangeMSG<T> = {
  dbName: string;
  operation: "db.change";
  item: T;
  type: string;
}

type OnDeleteMSG = {
  dbName: string;
  operation: "db.delete";
  itemId: string;
  type: string;
}

type OnDBItemChangeCallback<Type> = (msg: OnChangeMSG<Type>|OnDeleteMSG)=>any

type NotificationMessage = {
  severity: string;
  message: string;
  debug?: any;
}

type LogMessage = {
  id: string;
  timestamp: string;
  component: string | "log";
  severity: string;
  message: string;
  debug?: any;
}

type LogMessages = LogMessage[];

type LogMessagesCallback = (LogMessages)=>any;

type BaseDBItem = {
  id: string;
  lastSave?: number;
  createdTimestamp?: number;
}

type SavedDBItem = BaseDBItem & {
  lastSave: number;
  createdTimestamp: number;
}

type WsRpcMessageDocker = {
  target: "Docker";
  dockerId: string;
}

type WsRpcMessageDatabase = {
  target: "Database";
  dbName: string;
}

type WsRpcMessageController = {
  target: "Controller";
}

type WsRpcMessage = {
  message: "rpc.call";
  rpcId: any;
  method: string;
  args: any[];
} & (WsRpcMessageDocker | WsRpcMessageDatabase | WsRpcMessageController | {target: "";})


type PackDumpsInfo = {
  config: {
    current: string,
    expected: string,
    isOk: boolean,
  }
  dumps: {
    [pcid:string]: {
      my: string[],
      manual: string[],
      others: string[],
    }
  }
  errors?: string[],
}