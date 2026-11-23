// Which Drive folder gets which company. A company names its folder with "target" in config/companies.json;
// the folders are in config/targets.json. The first target is the default, and it also gets _unmatched.
/** @returns {(company: string) => string} the root folder id for a company name. */
export async function openTargets({ store, companies, targets }) {
  const names = new Set(targets.map((t) => t.name));
  const bad = companies.find((c) => c.target && !names.has(c.target));
  if (bad) throw new Error(`config/companies.json: "${bad.name}" has target "${bad.target}", which is not in config/targets.json.`);
  const roots = new Map();
  for (const t of targets) roots.set(t.name, t.folderId ?? (await store.folder(t.folderName)));
  const byCompany = new Map(companies.map((c) => [c.name, c.target ?? targets[0].name]));
  return (company) => roots.get(byCompany.get(company) ?? targets[0].name);
}
