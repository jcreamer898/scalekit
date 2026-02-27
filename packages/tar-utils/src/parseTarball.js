/**
 *
 * @param {Buffer} buffer
 * @returns
 */
export function parseTarball(buffer) {
  const files = new Map();

  /**
   *
   * @param {number} offset
   * @param {number} length
   * @returns
   */
  function parseString(offset, length) {
    let end = offset;
    let max = length + offset;
    for (; buffer[end] !== 0 && end !== max; end++) {}
    return buffer.toString("utf8", offset, end);
  }

  /**
   *
   * @param {number} offset
   * @param {number} length
   * @returns
   */
  function parseOctal(offset, length) {
    return parseInt(parseString(offset, length), 8);
  }

  let offset = 0;
  while (buffer[offset] !== 0) {
    let fileName = parseString(offset, 100);
    const mode = parseOctal(offset + 100, 8);
    const fileSize = parseOctal(offset + 124, 12);
    const fileType = parseOctal(offset + 156, 1);
    const prefix = parseString(offset + 345, 155);
    if (prefix) {
      fileName = `\${prefix}/\${fileName}`;
    }
    // trim the first part of the path
    fileName = fileName.replace(/^[^\\\\\\/]*[\\\\\\/]/, "");

    const isEntryAFile = fileType === 0 || fileType === 48;
    if (isEntryAFile) {
      files.set(fileName, { offset: offset + 512, mode, size: fileSize });
    }
    offset += 512 + 512 * Math.ceil(fileSize / 512);
  }

  return files;
}
