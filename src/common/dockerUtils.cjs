const { streamToBuffer } = require('./streams.cjs');

// https://docs.docker.com/engine/api/v1.26/#operation/ContainerAttach
/** 
 * @param {object} param
 * @param {import('stream').Duplex} [param.stream]
 * @param {Buffer} [param.buffer]
 * */
async function parseDockerData({stream, buffer})
{
    buffer = buffer ? buffer : (await streamToBuffer(stream));
    if (!buffer) throw new Error("Unexpected");
    const data = [];
    let msgLenPosition = 4;
    let msgLength, msgStart;
    while (msgLenPosition + 4 < buffer.byteLength)
    {
        msgLength = buffer.readUInt32BE(msgLenPosition);
        msgStart = msgLenPosition + 4;
        if (msgStart + msgLength > buffer.byteLength)
        {
            console.error("Out of buffer");
            data.push(buffer.subarray(msgStart));
            break;
        }
        data.push(buffer.subarray(msgStart, msgStart + msgLength));
        msgLenPosition = msgStart + msgLength + 4;
    }
    return Buffer.concat(data);
}

/** 
 * @param {object} param
 * @param {import('stream').Duplex} [param.stream]
 * @param {Buffer} [param.buffer]
 * @param {BufferEncoding} [param.encoding]
 * */
async function dockerStreamToString({stream, buffer, encoding='utf-8'})
{
  let data = (await parseDockerData({stream, buffer}));
  return data.toString(encoding);
}

module.exports = {
  parseDockerData,
  dockerStreamToString,
};