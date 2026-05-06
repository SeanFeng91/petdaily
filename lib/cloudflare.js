export async function getD1Database() {
  if (process.env.PETDAILY_DATA_PROVIDER !== "d1") {
    return null;
  }

  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const context = await getCloudflareContext({ async: true });
    return context?.env?.DB || null;
  } catch {
    return null;
  }
}
