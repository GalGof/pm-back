const fs = require("fs/promises");
const path = require("path");
const { providers, MsgLvl, } = require("./Notifications.cjs");
const fsUtils = require("./common/fsUtils.cjs");

const dbRootPath = "./database";

/** @type {{[x:string]: BaseDatabase<BaseDBItem>}} */
const db_collections = {};
/** @type {{[x:string]: BaseLiveQueue<BaseDBItem>}} */
const queue_collections = {};

/** @template {BaseDBItem} T */
class BaseCollection
{
  /** @param {string} dbName */
  constructor(dbName)
  {
    this.dbName = dbName;
    /** @type {T[]} */
    this._items = [];
    /** @type {OnDBItemChangeCallback<T>[]} */
    this._onChangeCallbacks = [];
  }
  /** @returns unsubscribe callback */
  subscribeOnItemChanges(/** @type {OnDBItemChangeCallback<T>}*/callback)
  {
    this._onChangeCallbacks.push(callback);
    return ()=>{let idx = this._onChangeCallbacks.findIndex(q=>q==callback); idx >= 0 && this._onChangeCallbacks.splice(idx, 1);};
  }
  _save(/** @type {T} */ item)
  {
    let idx = this._items.findIndex(it=>it.id == item.id);
    if (idx >= 0) {
      // dont change original obj ref
      Object.assign(this._items[idx], item);
    } else {
      this._items.push(item);
    }
    this.lastChange = +new Date();
    /** @type {OnChangeMSG<T>} */
    let msg = {
      dbName: this.dbName,
      item,
      operation: "db.change",
      type: "db.info",
    };
    this._onChangeCallbacks.forEach(q=>q(msg));
  }
  _delete(/** @type {string} */id)
  {
    this.lastChange = +new Date();
    let idx = this._items.findIndex(it=>it.id == id);
    if (idx >= 0) {
      this._items.splice(idx, 1);
    }
    /** @type {OnDeleteMSG} */
    let msg = {
      dbName: this.dbName,
      itemId: id,
      operation: "db.delete",
      type: "db.info",
    };
    this._onChangeCallbacks.forEach(q=>q(msg));
  }
}

/** @template {BaseDBItem} Q @extends {BaseCollection<Q>} */
class BaseLiveQueue extends BaseCollection
{
  /** @param {string} dbName */
  constructor(dbName)
  {
    super(dbName);
    queue_collections[dbName] = this;
    this.lastId = 0;
  }
  getNextId()
  {
    return this.lastId++;
  }
  getItems()
  {
    return this._items;
  }
  save(/** @type {Q} */item)
  {
    item.lastSave = +new Date();
    super._save(item);
  }
  delete(/** @type {string} */itemId)
  {
    super._delete(itemId);
  }
}

/** @template {BaseDBItem} Q @extends {BaseCollection<Q>} */
class BaseDatabase extends BaseCollection
{
  /** @param {string} dbName */
  constructor(dbName)
  {
    super(dbName);
    db_collections[dbName] = this;
    this._dbPath = path.join(dbRootPath, dbName);
    this._saveChain = Promise.resolve();
    this.lastChange = 0;
  }
  async init()
  {
    await fsUtils.mkdir_if_not_exists(this._dbPath);
    let fileNames = await fs.readdir(this._dbPath);
    // restore all bak files if there were some err mid save before
    let baks = fileNames.filter(q=>q.match(/\.bak$/));
    for (let bak of baks) {
      let orgName = bak.replace(/\.bak$/, '');
      if (fileNames.includes(orgName)) {
        await fs.unlink(path.join(this._dbPath, orgName));
      } else {
        await fs.rename(path.join(this._dbPath, bak), path.join(this._dbPath, orgName));
        fileNames.push(orgName);
      }
    }
    let cleanFiles = fileNames.filter(q=>q.match(/\.json$/));
    /** @type {Q[]} */
    let items = [];
    for (let file of cleanFiles) {
      let id = /^(.+)\.json$/.exec(file)[1];
      try {
        let fcontent = await fs.readFile(path.join(this._dbPath, file), {encoding: 'utf-8'});
        let parsedData = JSON.parse(fcontent);
        items.push(parsedData);
        if (parsedData.id !== id) {
          parsedData.id = id;
          this.save(parsedData);
        }
      } catch (err) {
        providers.database.postMessage({severity: MsgLvl.critical, message: `Bad file: ${path.join(this._dbPath, file)}`, debug: err});
      }
    }
    this.lastChange = +new Date();
    this._items = items.sort((q, w)=>q.lastSave - w.lastSave);
    console.log(this.dbName, "db loaded");
    return true;
  }
  getItems()
  {
    return this._items;
  }
  async _save(/** @type {Q} */item)
  {
    if (!item.id) throw new Error("Bad item id");
    item.lastSave = +new Date();
    let filepath = path.join(this._dbPath, `${item.id}.json`);
    let bakpath = filepath + '.bak';
    await fsUtils.unlink_if_exists(bakpath);
    let hadOld = await fsUtils.rename_if_exists(filepath, bakpath);
    if (!hadOld) item.createdTimestamp = +new Date();
    await fs.writeFile(filepath, JSON.stringify(item, null, 2));
    if (hadOld) await fs.unlink(bakpath);
    super._save(item);
  }
  save(/** @type {Q} */item)
  {
    let saveLink = this._saveChain.then(()=>this._save(item))
    this._saveChain = saveLink.catch((err)=>{
      providers.database.postMessage({severity: MsgLvl.critical, message: `Failed to save item(${item.id})`, debug: err});
    });
    return saveLink;
  }
  async _delete(/** @type {string} */id)
  {
    let filepath = path.join(this._dbPath, `${id}.json`);
    // atm better to know if there is wrong delete calls
    // but in stable version there may be double delete calls we dont really care about?..
    // if (!await fsUtils.unlink_if_exists(filepath)) return;
    await fs.unlink(filepath);
    super._delete(id);
  }
  delete(/** @type {string} */id)
  {
    let deleteLink = this._saveChain.then(()=>this._delete(id));
    this._saveChain = deleteLink.catch((err)=>{
      providers.database.postMessage({severity: MsgLvl.critical, message: `Failed to delete item(${id})`, debug: err});
    });
    return deleteLink;
  }
}

module.exports = {
  db_collections,
  queue_collections,
  BaseDatabase,
  BaseLiveQueue,
  dbRootPath,
}
