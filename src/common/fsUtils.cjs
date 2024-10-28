const fs = require("fs/promises");
const {c_false, c_true} = require("./callbackUtils.cjs");

async function unlink_if_exists(/** @type {string}*/filepath) {
  try {
    await fs.unlink(filepath);
    return true;
  } catch (error) {
    return false;
  }
}

async function rename_if_exists(/** @type {string}*/oldPath, /** @type {string}*/newPath) {
  try {
    await fs.rename(oldPath, newPath);
    return true;
  } catch (error) {
    return false;
  }
}

async function mkdir_if_not_exists(/** @type {string}*/dirPath) {
  try {
    await fs.mkdir(dirPath, {recursive: true});
    return true;
  } catch (error) {
    return false;
  }
}

module.exports = {
  mkdir_if_not_exists,
  rename_if_exists,
  unlink_if_exists,
}
