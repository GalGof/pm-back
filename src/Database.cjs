const fs = require("fs/promises");
const fs_ = require("fs");
const path = require("path");
const { BaseDatabase, dbRootPath } = require("./BaseDatabase.cjs");

const sshKeysPath = path.join(dbRootPath, 'sshKeys');
function getSSHKeys()
{
  return fs.access(sshKeysPath)
    .catch(()=>fs.mkdir(sshKeysPath))
    .then(()=>fs.readdir(sshKeysPath))
    .then((names)=>Promise.all(names.map((name)=>fs.stat(path.join(sshKeysPath, name))
            .then(q=>{return {name, isFile: q.isFile()}})))
            .then(q=>q.filter(q=>q.isFile).map(q=>q.name)))
    .then((files)=>Promise.all(files.map((file)=>fs.readFile(path.join(sshKeysPath, file), {encoding: "utf-8"}).then(q=>{return {name: file.replace('.json', ''), ...JSON.parse(q)}}))))
}

/** @type {{name: string, private: string, public: string, passphrase: string}[]} */
const sshKeys = [];
async function initSSHKeys()
{
  sshKeys.push(...(await getSSHKeys()));
  // for (const info of sshKeys) {
  //   await fs.mkdir() 
  //   await fs.writeFile()
  // }
}

function getSSHKeyByName(/** @type {string}*/name)
{
  return sshKeys.find(it=>it.name == name);
}

/** @type {BaseDatabase<DockerEngineInfo>} */
const dockerEnginesInfo = new BaseDatabase("dockerEngines");
/** @type {BaseDatabase<DeployedInfo>} */
const deployedInfo = new BaseDatabase("deployed");
/** @type {BaseDatabase<BundleInfo>} */
const bundlesInfo = new BaseDatabase("bundles");
/** @type {BaseDatabase<BuilderInfo>} */
const buildersInfo = new BaseDatabase("builders");
/** @type {BaseDatabase<DockerRegistryInfo>} */
const dockerRegistriesInfo = new BaseDatabase("dockerRegistries");
/** @type {BaseDatabase<SharedDataInfo>} */
const sharedDataInfo = new BaseDatabase("sharedData");

// dockerEngines.Items().then(q=>q[0].)

const mainConfigPath = path.join(dbRootPath, 'config.json');
const mainConfig = fs_.existsSync(mainConfigPath) ? 
  JSON.parse(fs_.readFileSync(mainConfigPath).toString()) : 
  {
    adminAccessKey: "3338908027751811",
  };

function UpdateMainConfig(/** @type {object}*/newConfig)
{
  Object.assign(mainConfig, newConfig);
  return fs.writeFile(mainConfigPath, JSON.stringify(mainConfig, null, 2))
}

const PerformanceLogsPath = "./database/perfLogs";

async function initDatabase()
{
  const {db_collections} = require("./BaseDatabase.cjs");
  const {ResourcesRegistryId} = require("puppet-masters/DockerWrapper");

  await Promise.all(Object.values(db_collections).map(it=>it.init().catch(error=>{
    console.error(it.dbName, "db init exception", error);
    process.exit(2);
  })));
  await initSSHKeys();
  if (!dockerRegistriesInfo.getItems().find(it=>it.id == ResourcesRegistryId)) {
    await dockerRegistriesInfo.save({id: ResourcesRegistryId, name: "System Resources", address: "", lastSave: 0, hidden: false});
  }

  await fs.mkdir(PerformanceLogsPath, {recursive: true});
}

module.exports = {
  initDatabase,
  sshKeys,
  initSSHKeys,
  getSSHKeyByName,
  dockerEnginesInfo,
  deployedInfo,
  bundlesInfo,
  buildersInfo,
  dockerRegistriesInfo,
  sharedDataInfo,
  mainConfig,
  UpdateMainConfig,
  PerformanceLogsPath,
}