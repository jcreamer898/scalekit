export function readIntegerFromEnv(variableName, defaultValue, verbose) {
  const envVar = process.env[variableName];
  if (!envVar) {
    if (verbose) {
      console.log(
        `[INFO] The variable ${variableName} cannot be found, using default value (${defaultValue}).`
      );
    }
    return defaultValue;
  }
  try {
    let parsed = parseInt(envVar);
    if (parsed !== parsed) {
      // Parsed to NaN
      throw new Error("Parsing failed");
    }
    if (verbose) {
      console.log(
        `[INFO] The variable ${variableName} is used. (value: ${parsed})`
      );
    }
    return parsed;
  } catch (e) {
    console.error(
      `The variable ${variableName} ("${envVar}") cannot be parsed to an integer, using default value instead (${defaultVaule})`
    );
    return defaultValue;
  }
}
