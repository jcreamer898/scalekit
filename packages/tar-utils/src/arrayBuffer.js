/**
 *
 * @param {import("node:stream").Readable} readableStream
 * @returns
 */
export function toSharedArrayBuffer(readableStream) {
  return new Promise((resolve, reject) => {
    /**
     * @type {Buffer[]}
     */
    const chunks = [];

    let length = 0;
    readableStream.on("end", () => {
      const result = Buffer.from(new SharedArrayBuffer(length));
      let offset = 0;

      for (let chunk of chunks) {
        chunk.copy(result, offset);
        offset += chunk.length;
      }

      resolve(result);
    });

    readableStream.on("error", (e) => {
      reject(e);
    });

    readableStream.on("data", (chunk) => {
      chunks.push(Buffer.from(chunk));
      length += chunk.length;
    });
  });
}
