async function getCloudflareEnv() {
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const context = await getCloudflareContext({ async: true });
    return context?.env || null;
  } catch {
    return null;
  }
}

export async function getD1Database() {
  if (process.env.PETDAILY_DATA_PROVIDER !== "d1") {
    return null;
  }

  const env = await getCloudflareEnv();
  return env?.DB || null;
}

export async function getBarkAudioBucket() {
  if (process.env.PETDAILY_DATA_PROVIDER !== "d1") {
    return null;
  }

  const env = await getCloudflareEnv();
  return env?.BARK_AUDIO || null;
}
