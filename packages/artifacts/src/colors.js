import util from "node:util";

/**
 * @param {string} s 
 * @returns 
 */
export const black = (s) => util.format('\x1b[30m%s\x1b[0m', s);

/**
 * @param {string} s 
 * @returns 
 */
export const red = (s) => util.format('\x1b[31m%s\x1b[0m', s);
/**
 * @param {string} s 
 * @returns 
 */
export const green = (s) => util.format('\x1b[32m%s\x1b[0m', s);
/**
 * @param {string} s 
 * @returns 
 */
export const yellow = (s) => util.format('\x1b[33m%s\x1b[0m', s);
/**
 * @param {string} s 
 * @returns 
 */
export const blue = (s) => util.format('\x1b[34m%s\x1b[0m', s);
/**
 * @param {string} s 
 * @returns 
 */
export const magenta = (s) => util.format('\x1b[35m%s\x1b[0m', s);
/**
 * @param {string} s 
 * @returns 
 */
/**
 * @param {string} s 
 * @returns 
 */export const cyan = (s) => util.format('\x1b[36m%s\x1b[0m', s);

 /**
 * @param {string} s 
 * @returns 
 */
export const white = (s) => util.format('\x1b[37m%s\x1b[0m', s);