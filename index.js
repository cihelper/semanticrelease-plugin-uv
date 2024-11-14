// https://github.com/semantic-release/semantic-release/blob/master/docs/usage/plugins.md
import { parse } from "@iarna/toml";
import { execa } from "execa";
import { readFileSync } from "fs";
import { join, resolve } from "path";

const channelMap = {
  alpha: "a",
  beta: "b",
  next: "rc",
  rc: "rc",
  // dev is not definded as it is the default fallback value
};

// nextRelease.type: patch
// nextRelease.channel: beta
// nextRelease.version: 1.2.3-beta.1
// nextRelease.gitTag: v1.2.3-beta.1
// nextRelease.name: v1.2.3-beta.1

export async function prepare(pluginConfig, context) {
  // https://github.com/semantic-release/npm/blob/master/lib/prepare.js
  const {
    cwd,
    env,
    stdout,
    stderr,
    nextRelease: { version, channel },
    logger,
  } = context;
  const { pkgRoot } = pluginConfig;

  const basePath = pkgRoot ? resolve(cwd, pkgRoot) : cwd;

  const [mainVersion, versionSuffix] = version.split("-");
  let pepVersion = mainVersion;

  if (versionSuffix !== undefined) {
    const [, buildVersion] = versionSuffix.split(".");

    if (buildVersion !== undefined) {
      const separator = channelMap[channel] ?? "dev";
      pepVersion = `${mainVersion}${separator}${buildVersion}`;
    }
  }

  // uv currently has no way to update the version in the pyproject.toml file, so we use sed
  const pyprojectVersionResult = execa(
    "sed",
    [
      "-i",
      `s/^version = ".*"$/version = "${pepVersion}"/`,
      join(basePath, "pyproject.toml"),
    ],
    {
      cwd: basePath,
      env,
      preferLocal: true,
    },
  );
  pyprojectVersionResult.stdout.pipe(stdout, { end: false });
  pyprojectVersionResult.stderr.pipe(stderr, { end: false });
  await pyprojectVersionResult;

  logger.log("Updating the lockfile");
  const lockResult = execa("uv", ["lock"], {
    cwd: basePath,
    env,
    preferLocal: true,
  });
  lockResult.stdout.pipe(stdout, { end: false });
  lockResult.stderr.pipe(stderr, { end: false });
  await lockResult;

  logger.log("Creating pypi package version %s", version);
  const buildresult = execa("uv", ["build"], {
    cwd: basePath,
    env,
    preferLocal: true,
  });
  buildresult.stdout.pipe(stdout, { end: false });
  buildresult.stderr.pipe(stderr, { end: false });
  await buildresult;
}

export async function publish(pluginConfig, context) {
  // https://github.com/semantic-release/npm/blob/master/lib/publish.js
  const { cwd, env, stdout, stderr, logger } = context;
  const { pkgRoot, uvPublish } = pluginConfig;

  if (uvPublish !== false) {
    const basePath = pkgRoot ? resolve(cwd, pkgRoot) : cwd;

    const pyprojectContent = readFileSync(
      join(basePath, "pyproject.toml"),
    ).toString();
    const pyproject = parse(pyprojectContent);
    const pypiName = pyproject.project.name;
    const pypiVersion = pyproject.project.version;

    logger.log(`Publishing version ${pypiVersion} to pypi registry`);

    const result = execa("uv", ["publish", "-v"], {
      cwd: basePath,
      env,
      preferLocal: true,
    });
    result.stdout.pipe(stdout, { end: false });
    result.stderr.pipe(stderr, { end: false });
    await result;

    logger.log(`Published ${pypiName}==${pypiVersion} to pypi`);

    return {
      name: `PyPI Package`,
      url: `https://pypi.org/project/${pypiName}/${pypiVersion}/`,
    };
  }

  logger.log(`Skip publishing to pypi due to uvPublish`);
  return false;
}
