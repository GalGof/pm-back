// @ts-nocheck
const { pipeline: pipelineOrg, Writable } = require('stream');

/** @return {Promise<Buffer>} */
function streamToBuffer(/** @type {NodeJS.WritableStream|NodeJS.ReadableStream}}*/stream) {
  /** @type {Buffer[]} */
  const chunks = [];
  return new Promise((resolve, reject) => {
    stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    stream.on('error', (err) => reject(err));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
  })
}

async function streamToString (/** @type {NodeJS.WritableStream|NodeJS.ReadableStream}}*/stream) {
    return (await streamToBuffer(stream)).toString('utf8');
}

async function pipeline(src, dest) {
  return new Promise((res, rej)=>{
    pipelineOrg(src, dest, (err)=>{
      if (err) {
        console.error("pipeline error", err);
        rej(err);
      } else res();
    })
  });
}

// http://codewinds.com/blog/2013-08-19-nodejs-writable-streams.html
class MWritable extends Writable
{
  constructor(...args)
  {
    super(...args);
    this.buffer = Buffer.from('');
  }
  _write (chunk, enc, cb) {
    // our memory store stores things in buffers
    let buffer = (Buffer.isBuffer(chunk)) ?
      chunk :  // already is Buffer use it
      Buffer.from(chunk, enc);  // string, convert
  
    // concat to the buffer already there
    this.buffer = Buffer.concat([this.buffer, buffer]);
    cb();
  };
}

module.exports = {
  streamToBuffer,
  streamToString,
  pipeline,
  MWritable,
};