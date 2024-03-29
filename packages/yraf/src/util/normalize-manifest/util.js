const path = require("path");

const validateLicense = require("validate-npm-package-license");

const PARENT_PATH = /^\.\.([\\\/]|$)/;

export function isValidLicense(license) {
  return !!license && validateLicense(license).validForNewPackages;
}

export function isValidBin(bin) {
  return !path.isAbsolute(bin) && !PARENT_PATH.test(path.normalize(bin));
}

export function stringifyPerson(person) {
  if (!person || typeof person !== "object") {
    return person;
  }

  const parts = [];
  if (person.name) {
    parts.push(person.name);
  }

  const email = person.email || person.mail;
  if (typeof email === "string") {
    parts.push(`<${email}>`);
  }

  const url = person.url || person.web;
  if (typeof url === "string") {
    parts.push(`(${url})`);
  }

  return parts.join(" ");
}

export function parsePerson(person) {
  if (typeof person !== "string") {
    return person;
  }

  // format: name (url) <email>
  const obj = {};

  let name = person.match(/^([^\(<]+)/);
  if (name) {
    name = name[0].trim();
    if (name) {
      obj.name = name;
    }
  }

  const email = person.match(/<([^>]+)>/);
  if (email) {
    obj.email = email[1];
  }

  const url = person.match(/\(([^\)]+)\)/);
  if (url) {
    obj.url = url[1];
  }

  return obj;
}

export function normalizePerson(person) {
  return parsePerson(stringifyPerson(person));
}

export function extractRepositoryUrl(repository) {
  if (!repository || typeof repository !== "object") {
    return repository;
  }
  return repository.url;
}
